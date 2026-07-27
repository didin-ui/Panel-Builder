/* Panel Builder Assistant — backend penyimpanan
   Node.js + Express + better-sqlite3. Database: panelbuilder.db (dibuat otomatis). */
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

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
`);

const app = express();
/* Library komponen menyimpan gambar sebagai data URI, jadi payload bisa jauh
   lebih besar dari 1 MB. Front-end sudah menyusutkan gambar sebelum kirim. */
app.use(express.json({ limit: '25mb' }));
app.use(express.static(__dirname));

app.get('/api/health', (req, res) => res.json({ ok: true, db: 'sqlite' }));

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
    if (library)  setKv.run('library',  JSON.stringify(library));
  });
  try {
    tx();
  } catch (e) {
    console.error('sync failed:', e.message);
    return res.status(500).json({ error: 'database write failed: ' + e.message });
  }
  res.json({ ok: true, saved: projects.length });
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
app.listen(PORT, () =>
  console.log(`Panel Builder Assistant → http://localhost:${PORT}  (db: panelbuilder.db)`));
