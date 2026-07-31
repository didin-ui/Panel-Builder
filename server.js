/* Panel Builder Assistant — backend penyimpanan
   Node.js + Express + better-sqlite3. Database: panelbuilder.db (dibuat otomatis). */
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const db = new Database(path.join(__dirname, 'panelbuilder.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    customer TEXT DEFAULT '',
    rev      TEXT DEFAULT 'A',
    cfg      TEXT NOT NULL,
    updated  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  /* Gambar komponen disimpan terpisah sebagai BLOB, bukan data URI di dalam
     JSON library. Dulu satu baris kv menampung semuanya, jadi tiap penyimpanan
     menulis ulang seluruh megabyte-nya dan localStorage cepat penuh. */
  CREATE TABLE IF NOT EXISTS images (
    key     TEXT PRIMARY KEY,
    mime    TEXT NOT NULL,
    bytes   BLOB NOT NULL,
    updated INTEGER NOT NULL
  );
`);

/* ══════════ MIGRASI: gambar keluar dari kv.library ══════════
   Versi lama menyimpan data URI di dalam JSON library. Pindahkan sekali ke
   tabel images, lalu VACUUM untuk mengembalikan halaman yang terbuang oleh
   penulisan ulang baris besar berkali-kali. */
function migrateImages() {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('library');
  if (!row) return;
  let lib;
  try { lib = JSON.parse(row.value); } catch (e) { return; }
  const comps = (lib && lib.components) || {};
  const put = db.prepare(`INSERT INTO images (key, mime, bytes, updated) VALUES (?,?,?,?)
                          ON CONFLICT(key) DO UPDATE SET
                            mime=excluded.mime, bytes=excluded.bytes, updated=excluded.updated`);
  let moved = 0, bytes = 0;
  const tx = db.transaction(() => {
    for (const key of Object.keys(comps)) {
      const img = comps[key] && comps[key].image;
      if (typeof img !== 'string' || !img.startsWith('data:')) continue;
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(img);
      if (!m) continue;
      const buf = Buffer.from(m[2], 'base64');
      put.run(key, m[1], buf, Date.now());
      delete comps[key].image;
      comps[key].hasImage = true;
      comps[key].imgVersion = Date.now();
      /* patch yang isinya hanya gambar tidak perlu field lain */
      moved++; bytes += buf.length;
    }
    if (moved) db.prepare('UPDATE kv SET value = ? WHERE key = ?')
      .run(JSON.stringify(lib), 'library');
  });
  tx();
  if (moved) {
    console.log(`  migrasi: ${moved} gambar (${(bytes / 1024 / 1024).toFixed(1)} MB) ` +
                `dipindah dari kv.library ke tabel images`);
    /* VACUUM lalu checkpoint(TRUNCATE) — bukan sebaliknya. Di mode WAL, VACUUM
       menulis ke WAL, jadi file utama baru menyusut setelah di-checkpoint. */
    const file = path.join(__dirname, 'panelbuilder.db');
    const mb = (f) => { try { return fs.statSync(f).size / 1024 / 1024; } catch (e) { return 0; } };
    const before = mb(file) + mb(file + '-wal');
    db.exec('VACUUM');
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log(`  VACUUM: ${before.toFixed(1)} MB → ` +
                `${(mb(file) + mb(file + '-wal')).toFixed(1)} MB di disk`);
  }
}
migrateImages();

const app = express();
/* Payload sync sekarang kecil karena gambar tidak lagi ikut. Batas ini hanya
   perlu menampung satu gambar per PUT /api/image/:key. */
app.use(express.json({ limit: '8mb' }));
/* HANYA public/ yang dilayani. Sebelumnya ini `express.static(__dirname)`, yang
   berarti panelbuilder.db — seluruh proyek dan data customer — bisa diunduh
   siapa pun yang menjangkau port ini, begitu juga setiap file backup *.db,
   server.js dan package.json. app.listen() tanpa host mengikat 0.0.0.0, jadi
   itu berlaku untuk seluruh jaringan, bukan cuma mesin sendiri. */
const CLIENT_DIR = path.join(__dirname, 'public');
app.use(express.static(CLIENT_DIR, { dotfiles: 'deny', index: 'index.html' }));

app.get('/api/health', (req, res) => res.json({
  ok: true, db: 'sqlite', images: true,
  imageCount: db.prepare('SELECT count(*) AS n FROM images').get().n,
}));

/* Klien versi lama masih bisa mengirim data URI di dalam library. Jangan
   simpan balik ke JSON — pindahkan ke tabel images, supaya masalah lama tidak
   muncul lagi lewat pintu belakang. */
function stripImages(library) {
  const comps = (library && library.components) || {};
  const put = db.prepare(`INSERT INTO images (key, mime, bytes, updated) VALUES (?,?,?,?)
                          ON CONFLICT(key) DO UPDATE SET
                            mime=excluded.mime, bytes=excluded.bytes, updated=excluded.updated`);
  for (const key of Object.keys(comps)) {
    const img = comps[key] && comps[key].image;
    if (typeof img !== 'string' || !img.startsWith('data:')) continue;
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(img);
    delete comps[key].image;
    if (!m) continue;
    put.run(key, m[1], Buffer.from(m[2], 'base64'), Date.now());
    comps[key].hasImage = true;
    comps[key].imgVersion = Date.now();
  }
  return library;
}

const getKv = (key) => {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  try { return row ? JSON.parse(row.value) : null; } catch (e) { return null; }
};
const setKv = db.prepare(
  'INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');

/* Seluruh state: daftar proyek + settings engine + library komponen */
app.get('/api/state', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY updated DESC').all()
    .map(r => ({ ...r, cfg: JSON.parse(r.cfg) }));
  res.json({ projects, settings: getKv('settings'), library: getKv('library') });
});

/* Sinkron penuh dari front-end: upsert semua proyek, hapus yang tidak ada lagi,
   simpan settings + library. Divalidasi dulu supaya payload rusak tidak
   menghapus data — dan kegagalan dilaporkan, tidak ditelan diam-diam. */
app.post('/api/sync', (req, res) => {
  const { projects, settings = null, library = null } = req.body || {};
  if (!Array.isArray(projects))
    return res.status(400).json({ error: 'projects must be an array' });
  const bad = projects.findIndex(p =>
    !p || !Number.isInteger(p.id) || typeof p.name !== 'string' || !p.name || p.cfg == null);
  if (bad >= 0)
    return res.status(400).json({ error: `projects[${bad}] needs an integer id, a name and a cfg` });

  const upsert = db.prepare(`
    INSERT INTO projects (id, name, customer, rev, cfg, updated)
    VALUES (@id, @name, @customer, @rev, @cfg, @updated)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, customer=excluded.customer, rev=excluded.rev,
      cfg=excluded.cfg, updated=excluded.updated`);
  const tx = db.transaction(() => {
    const keep = projects.map(p => p.id);
    if (keep.length)
      db.prepare(`DELETE FROM projects WHERE id NOT IN (${keep.map(() => '?').join(',')})`).run(...keep);
    else
      db.prepare('DELETE FROM projects').run();
    for (const p of projects)
      upsert.run({ id: p.id, name: p.name, customer: p.customer || '', rev: p.rev || 'A',
                   cfg: JSON.stringify(p.cfg), updated: p.updated || Date.now() });
    if (settings) setKv.run('settings', JSON.stringify(settings));
    if (library)  setKv.run('library',  JSON.stringify(stripImages(library)));
  });
  try {
    tx();
  } catch (e) {
    console.error('sync failed:', e.message);
    return res.status(500).json({ error: 'database write failed: ' + e.message });
  }
  res.json({ ok: true, saved: projects.length });
});

/* ══════════ GAMBAR KOMPONEN ══════════
   Satu endpoint per gambar: penyimpanan proyek tidak lagi menulis ulang
   seluruh library, dan browser bisa cache tiap gambar terpisah. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

/* Daftar gambar yang ada — dipakai front-end untuk rekonsiliasi, tanpa
   mengunduh byte-nya. */
app.get('/api/images', (req, res) => {
  res.json(db.prepare(
    'SELECT key, mime, length(bytes) AS size, updated FROM images ORDER BY key').all());
});

app.get('/api/image/:key', (req, res) => {
  const r = db.prepare('SELECT mime, bytes, updated FROM images WHERE key = ?').get(req.params.key);
  if (!r) return res.status(404).json({ error: 'not found' });
  const etag = '"' + r.updated + '-' + r.bytes.length + '"';
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.set({
    'Content-Type': r.mime,
    'Content-Length': r.bytes.length,
    ETag: etag,
    /* must-revalidate: imgVersion pada URL yang menentukan kebaruan */
    'Cache-Control': 'private, max-age=31536000, must-revalidate',
  });
  res.end(r.bytes);
});

app.put('/api/image/:key', (req, res) => {
  const key = req.params.key;
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'invalid key' });
  const { dataUrl } = req.body || {};
  if (typeof dataUrl !== 'string')
    return res.status(400).json({ error: 'body needs { dataUrl }' });
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return res.status(400).json({ error: 'dataUrl must be a base64 data URI' });
  if (!ALLOWED_MIME.includes(m[1]))
    return res.status(415).json({ error: 'unsupported type ' + m[1] });
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); }
  catch (e) { return res.status(400).json({ error: 'bad base64' }); }
  if (!buf.length) return res.status(400).json({ error: 'empty image' });
  if (buf.length > MAX_IMAGE_BYTES)
    return res.status(413).json({ error: `image ${(buf.length / 1024 / 1024).toFixed(1)} MB ` +
      `exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit` });
  const updated = Date.now();
  try {
    db.prepare(`INSERT INTO images (key, mime, bytes, updated) VALUES (?,?,?,?)
                ON CONFLICT(key) DO UPDATE SET
                  mime=excluded.mime, bytes=excluded.bytes, updated=excluded.updated`)
      .run(key, m[1], buf, updated);
  } catch (e) {
    console.error('image write failed:', e.message);
    return res.status(500).json({ error: 'database write failed: ' + e.message });
  }
  res.json({ ok: true, key, mime: m[1], size: buf.length, updated });
});

app.delete('/api/image/:key', (req, res) => {
  const info = db.prepare('DELETE FROM images WHERE key = ?').run(req.params.key);
  res.json({ ok: true, deleted: info.changes });
});

/* Ambil satu proyek (untuk integrasi lain, mis. dipanggil dari Qscada) */
app.get('/api/projects/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({ ...r, cfg: JSON.parse(r.cfg) });
});

/* Body terlalu besar / JSON rusak: balas JSON, bukan halaman error HTML,
   supaya front-end bisa menampilkan pesannya. */
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large')
    return res.status(413).json({ error: 'payload too large — kecilkan gambar komponen' });
  if (err && err.status === 400)
    return res.status(400).json({ error: 'malformed JSON body' });
  return next(err);
});

const PORT = process.env.PORT || 3100;
/* HOST default localhost: aplikasi ini belum punya autentikasi apa pun, jadi
   mengikat 0.0.0.0 berarti setiap orang di jaringan bisa membaca, mengubah dan
   menghapus seluruh proyek lewat /api/projects. Set HOST=0.0.0.0 kalau memang
   sengaja mau dibagi — itu keputusan sadar, bukan default. */
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Panel Builder Assistant → http://localhost:${PORT}  (db: panelbuilder.db)`);
  if (HOST === '0.0.0.0')
    console.log('  ⚠  terbuka ke seluruh jaringan dan TANPA autentikasi.');
});
