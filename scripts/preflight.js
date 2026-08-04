#!/usr/bin/env node
/* Cek lingkungan sebelum menyalahkan aplikasinya.
   Dipakai lewat `npm run preflight`, dan dipanggil server.js kalau modul
   nativenya gagal dimuat — supaya yang muncul kalimat, bukan tumpukan
   error node-gyp yang tidak pernah menyebut kata "Node". */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ok = (s) => '  ✓ ' + s;
const bad = (s) => '  ✗ ' + s;
let problems = 0;

console.log('\nPanel Builder Assistant — pemeriksaan lingkungan\n');

/* ── 1. Versi Node ──────────────────────────────────────────────────── */
const major = Number(process.versions.node.split('.')[0]);
const abi = Number(process.versions.modules);
/* ABI yang punya binary siap pakai di better-sqlite3 12.x untuk Windows.
   Di luar daftar ini npm terpaksa mengkompilasi sendiri, dan itu butuh
   Visual Studio Build Tools + Python yang jarang ada di PC biasa. */
const PREBUILT_ABI = [127, 137, 141, 147];
console.log(`Node ${process.version}  (ABI ${abi}, ${process.platform}-${process.arch})`);
if (major < 22) {
  console.log(bad(`terlalu lama. Butuh Node 22 atau lebih baru.`));
  console.log('    Unduh LTS di https://nodejs.org lalu ulangi npm install.');
  problems++;
} else if (PREBUILT_ABI.indexOf(abi) < 0) {
  console.log(bad(`belum ada binary siap pakai better-sqlite3 untuk ABI ${abi}.`));
  console.log('    npm akan mencoba mengkompilasi sendiri dan biasanya gagal di');
  console.log('    Windows tanpa Visual Studio Build Tools. Pakai Node 22 atau 24.');
  problems++;
} else {
  console.log(ok('versi Node didukung, binary siap pakai tersedia'));
}

/* ── 2. Dependensi terpasang ────────────────────────────────────────── */
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  console.log(bad('node_modules belum ada — jalankan: npm install'));
  problems++;
} else {
  let db = null;
  try {
    db = require('better-sqlite3');
    const v = require('better-sqlite3/package.json').version;
    console.log(ok(`better-sqlite3 ${v} termuat`));
  } catch (e) {
    console.log(bad('better-sqlite3 gagal dimuat: ' + e.message.split('\n')[0]));
    console.log('    Biasanya berarti modul nativenya dibangun untuk versi Node lain.');
    console.log('    Perbaikan: hapus node_modules lalu npm install ulang.');
    problems++;
  }
  /* ── 3. Database benar-benar bisa dibuka & ditulis ─────────────────── */
  if (db) {
    const f = path.join(ROOT, 'panelbuilder.db');
    try {
      const h = new db(f);
      h.pragma('journal_mode = WAL');
      const n = h.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n;
      h.close();
      console.log(ok(`${fs.existsSync(f) ? 'database' : 'database baru'} bisa dibuka (${n} tabel)`));
    } catch (e) {
      console.log(bad('tidak bisa membuka/menulis panelbuilder.db: ' + e.message));
      console.log('    Cek izin tulis di folder ini, dan pastikan tidak ada');
      console.log('    instance lain yang sedang berjalan.');
      problems++;
    }
  }
}

/* ── 4. Port ────────────────────────────────────────────────────────── */
const PORT = Number(process.env.PORT) || 3100;
try {
  const net = require('net');
  const srv = net.createServer();
  srv.once('error', (e) => {
    console.log(bad(`port ${PORT} sudah dipakai (${e.code}).`));
    console.log(`    Jalankan dengan port lain: PORT=3200 npm start`);
    finish(problems + 1);
  });
  srv.once('listening', () => {
    srv.close(() => { console.log(ok(`port ${PORT} bebas`)); finish(problems); });
  });
  srv.listen(PORT, '127.0.0.1');
} catch (e) { finish(problems); }

function finish(n) {
  console.log('');
  if (n) {
    console.log(`${n} masalah ditemukan. Perbaiki yang bertanda ✗ di atas, lalu ulangi.`);
    process.exit(1);
  }
  console.log('Semua siap. Jalankan: npm start');
  process.exit(0);
}
