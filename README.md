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
- **Panel size (Tinggi × Lebar)** — ditulis **tinggi dulu**, seperti katalog
  enclosure: `400 × 300` = 400 tinggi × 300 lebar, jadi selalu **portrait**.
  Pilih `Auto` (tinggi dihitung dari layout, tetap dijaga portrait) atau ukuran
  katalog: 400×300, 500×400, 600×400, 800×600, 1000×800, 1200×800 mm. Ukuran yang
  dipilih dipakai apa adanya; kalau isinya tidak muat, muncul error
  `PANEL_TOO_SMALL` yang menyebutkan tinggi yang dibutuhkan. Panel lebih sempit
  biasanya butuh lebih tinggi karena rail terpaksa wrap.
- **Tab 2D panel layout / Front cover layout** — backplate (rail, duct, terminal)
  dan pintu (E-stop, HMI, tombol ON/OFF, selector, pilot lamp). Perangkat pintu
  ikut masuk BOM, wiring list, dan laporan.
- **Atur posisi front cover manual** — tarik komponen di tab Front cover.
  Posisi dibulatkan ke 5 mm, ditahan di dalam pintu, dan disimpan per proyek.
  Hanya komponen yang kamu pindah yang dipatok; sisanya tetap otomatis.
  Tombol **Reset posisi** mengembalikan semuanya ke otomatis.
- **Export** — dua tombol terpisah: **Layout PDF** (hanya gambar backplate +
  front cover, plus tabel koordinat X/Y) dan **Report PDF** (laporan lengkap:
  gambar kedua layout, tabel koordinat, kalkulasi, BOM, temuan review).
  Semua komponen punya tag (Q1, G1, S1, H1, HMI1 …) yang sama di gambar,
  tabel koordinat, dan BOM.
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
- **+ Panel** — tambahkan komponen ke proyek aktif. Pilih tujuannya:
  **Front cover** (pintu panel) atau **Rail 1 / 2 / 3** (dalam panel).
  Perangkat pintu otomatis default ke Front cover. Komponen yang ditambahkan
  muncul di gambar, bisa ditarik posisinya (kalau di front cover), masuk BOM,
  dan konsumsi 24 V-nya ikut dihitung. Satu komponen boleh dipakai di kedua
  tujuan sekaligus — BOM menjumlahkan keduanya.
- **Tab Front cover** — 35 perangkat pintu tersedia: pushbutton (berbagai warna,
  ada yang lampu), mushroom, E-stop (putar / kunci), selector 2–3 posisi & kunci,
  pilot lamp 5 warna, potensiometer, buzzer, beacon, HMI 4"/7"/10", ampere &
  volt meter analog, power/energy meter, hour meter, temperature controller,
  door lock, kaca inspeksi, service socket, port RJ45/USB.
  Tanda ◇ = part number masih generik (vendor belum ditentukan).
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
