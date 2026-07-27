# Panel Builder Assistant — Menjalankan dengan Database

## Kebutuhan
Node.js 18+ (cek: `node -v`)

## Langkah
```
cd panel-builder
npm install
npm start
```
Buka **http://localhost:3100** — indikator di kiri bawah sidebar harus berubah menjadi
"● Database connected". Semua proyek kini tersimpan di file `panelbuilder.db` (SQLite)
di folder yang sama, dan otomatis dipanggil kembali setiap aplikasi dibuka, dari
browser/komputer mana pun yang mengakses server ini.

## Mode tanpa server
`index.html` tetap bisa dibuka langsung (double-click) tanpa `npm start` —
indikator menunjukkan "● Local only" dan data disimpan di localStorage browser.
Saat server dijalankan lagi, data dari browser akan disinkronkan ke database
pada penyimpanan berikutnya.

## API (untuk integrasi, mis. dipanggil dari Qscada/MPEdge)
- `GET  /api/health`        — status server
- `GET  /api/state`         — semua proyek + settings
- `GET  /api/projects/:id`  — satu proyek (konfigurasi JSON)
- `POST /api/sync`          — simpan {projects, settings}

## Backup
Cukup salin file `panelbuilder.db`. (Mode WAL: salin saat server berhenti,
atau gunakan `sqlite3 panelbuilder.db ".backup backup.db"`.)
