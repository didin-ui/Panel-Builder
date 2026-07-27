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
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/api/health', (req, res) => res.json({ ok: true, db: 'sqlite' }));

/* Seluruh state: daftar proyek + settings engine */
app.get('/api/state', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY updated DESC').all()
    .map(r => ({ ...r, cfg: JSON.parse(r.cfg) }));
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('settings');
  res.json({ projects, settings: row ? JSON.parse(row.value) : null });
});

/* Sinkron penuh dari front-end: upsert semua proyek, hapus yang tidak ada lagi, simpan settings */
app.post('/api/sync', (req, res) => {
  const { projects = [], settings = null } = req.body || {};
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
    if (settings)
      db.prepare('INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run('settings', JSON.stringify(settings));
  });
  tx();
  res.json({ ok: true, saved: projects.length });
});

/* Ambil satu proyek (untuk integrasi lain, mis. dipanggil dari Qscada) */
app.get('/api/projects/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json({ ...r, cfg: JSON.parse(r.cfg) });
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () =>
  console.log(`Panel Builder Assistant → http://localhost:${PORT}  (db: panelbuilder.db)`));
