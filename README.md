# Panel Builder Assistant — Menjalankan dengan Database

## Kebutuhan
Node.js 18+ (cek: `node -v`)

## Struktur
| File | Isi |
|---|---|
| `engine.js` | Semua kalkulasi & pemilihan komponen. Murni, tanpa DOM, tanpa dependency. |
| `index.html` | UI + render. Tidak menghitung apa pun sendiri. |
| `server.js` | API penyimpanan (Express + SQLite). |
| `test/engine.test.js` | 125 assertion, jalankan `npm test`. |
| `ENGINEERING.md` | Dasar perhitungan: rumus, konstanta, standar, dan batasannya. |

`engine.js` bisa dipakai sendiri tanpa browser:
```js
const {compute, DEFAULT_CFG} = require('./engine.js');
const R = compute({...DEFAULT_CFG, vfd: 4, supplyV: 400, ambientC: 35});
console.log(R.mccb.pn, R.psu.pn, R.thermal.fans, R.bom.length);
```

## Test
```
npm test
```

> ⚠ **Sebelum pembelian:** dimensi dan part number di database komponen adalah
> estimasi engineering (`dimsVerified: false`) — verifikasi ke datasheet vendor.
> Aplikasi ini tidak punya data stok/lead time dan tidak akan menampilkannya.
> Baris BOM bertanda `estimated` adalah alowansi, bukan hasil kalkulasi.
> Ukuran kabel belum dihitung (belum ada voltage drop / grouping) — lihat
> [ENGINEERING.md](ENGINEERING.md).

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

## Panel designer
- **Panel size (L × T)** — pilih `Auto` (tinggi dihitung dari layout) atau ukuran
  katalog: 400×300, 500×400, 600×400, 800×600, 1000×800, 1200×800 mm. Ukuran yang
  dipilih dipakai apa adanya; kalau isinya tidak muat, muncul error
  `PANEL_TOO_SMALL` yang menyebutkan tinggi yang dibutuhkan. Panel lebih sempit
  biasanya butuh lebih tinggi karena rail terpaksa wrap.
- **Tab 2D panel layout / Front cover layout** — backplate (rail, duct, terminal)
  dan pintu (E-stop, HMI, tombol ON/OFF, selector, pilot lamp). Perangkat pintu
  ikut masuk BOM, wiring list, dan laporan (dengan tag S0–S5 / H1–H3 + posisi X/Y).
- **PLC → No PLC** — untuk panel tanpa PLC (relay logic / motor starter). CPU,
  modul I/O, dan Ethernet switch tidak dipasang; kontaktor dikomando dari tombol
  pintu lewat kontak latching. Angka I/O tetap tersimpan, jadi memilih PLC lagi
  memulihkan raknya.

## Components library
Menu **Components library** bisa dipakai untuk mengelola database komponen:

- **+ Tambah komponen** — komponen baru (kode unik, dimensi W×H×D, mounting,
  konsumsi 24 V, gambar).
- **Edit** — perbaiki dimensi/part number/vendor komponen bawaan. Perubahan
  disimpan sebagai override minimal, dan **ikut menghitung**: layout, ukuran
  kabinet, beban 24 V, panas, dan BOM langsung berubah.
- **Gambar** — klik atau jatuhkan file di area gambar. Otomatis disusutkan ke
  maks 360 px dan disimpan di database, jadi ikut terbawa ke komputer lain
  (tidak perlu file di `assets/components/`).
- **+ Panel** — tambahkan komponen ke layout proyek aktif (jumlah + rail).
  Muncul di gambar, BOM, dan perhitungan 24 V.
- **Reset / Hapus** — kembalikan komponen bawaan ke default, atau hapus
  komponen custom.

Centang *dimensi sudah diverifikasi* hanya setelah dicek ke datasheet — badge
itu satu-satunya pembeda antara angka pasti dan estimasi.

## API (untuk integrasi, mis. dipanggil dari Qscada/MPEdge)
- `GET  /api/health`        — status server
- `GET  /api/state`         — semua proyek + settings + library
- `GET  /api/projects/:id`  — satu proyek (konfigurasi JSON)
- `POST /api/sync`          — simpan {projects, settings, library}; payload
  divalidasi dulu, dan kegagalan dibalas JSON (bukan HTML) supaya UI bisa
  menampilkan pesannya. Limit body 25 MB karena gambar komponen.

## Backup
Cukup salin file `panelbuilder.db`. (Mode WAL: salin saat server berhenti,
atau gunakan `sqlite3 panelbuilder.db ".backup backup.db"`.)
