# Panel Builder Assistant — Menjalankan dengan Database

## Kebutuhan
Node.js 18+ (cek: `node -v`)

## Struktur
| File | Isi |
|---|---|
| `engine.js` | Semua kalkulasi & pemilihan komponen. Murni, tanpa DOM, tanpa dependency. |
| `index.html` | UI + render. Tidak menghitung apa pun sendiri. |
| `server.js` | API penyimpanan (Express + SQLite). |
| `test/engine.test.js` | 241 assertion, jalankan `npm test`. |
| `ASSET-LIST.md` | Ukuran piksel semua gambar & tekstur. |
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
- **4 tab gambar** — **2D panel layout** (backplate: rail, duct, terminal),
  **Front cover** (E-stop, HMI, tombol ON/OFF, selector, pilot lamp),
  **Left side** dan **Right side** (ventilasi). Semua perangkat masuk BOM,
  wiring list, dan laporan.
- **Panel sisi = tempat exhaust fan.** Dulu fan digambar di backplate dan
  memakan kolom 150 mm di rail 1 — padahal fan dilubangi di kulit enclosure,
  bukan dibaut ke plat. Sekarang: **intake berfilter di bawah sisi kiri**,
  **exhaust fan di atas sisi kanan**, jadi udara masuk bawah-kiri, menyapu drive,
  keluar atas-kanan. Satu intake per exhaust. Gambar dilihat dari luar, jadi
  lebar gambar = **kedalaman** panel. Tag `E1..` fan, `V1..` intake.
  Efek sampingnya: rail 1 dapat kembali lebar penuhnya.
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
  **Front cover** (pintu panel) atau **Rail 1 / 2 / 3 / 4** (dalam panel), atau **Left / Right side** (ventilasi).
  Default cerdas: perangkat pintu → Front cover, terminal block → Rail 4.
  Komponen yang ditambahkan muncul di gambar, bisa ditarik posisinya, masuk BOM,
  dan konsumsi 24 V-nya ikut dihitung. Satu komponen boleh dipakai di beberapa
  tujuan sekaligus — BOM menjumlahkan semuanya.
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
- `GET    /api/health`       — status server + jumlah gambar
- `GET    /api/state`        — semua proyek + settings + library (tanpa byte gambar)
- `GET    /api/projects/:id` — satu proyek (konfigurasi JSON)
- `POST   /api/sync`         — simpan {projects, settings, library}; payload
  divalidasi dulu, dan kegagalan dibalas JSON (bukan HTML) supaya UI bisa
  menampilkan pesannya. Sekarang ~0,2 KB karena gambar tidak ikut. Kalau klien
  lama masih mengirim data URI, server memindahkannya ke tabel `images`
  alih-alih menyimpannya balik ke JSON.
- `GET    /api/images`       — daftar gambar (key, mime, size, updated), tanpa byte
- `GET    /api/image/:key`   — byte gambar + ETag; kirim `If-None-Match` → 304
- `PUT    /api/image/:key`   — simpan gambar, body `{dataUrl}`, maks 2 MB
- `DELETE /api/image/:key`   — hapus gambar

## Penyimpanan gambar komponen
Gambar **tidak** disimpan di dalam JSON library dan **tidak** masuk localStorage.

| Di mana | Isi |
|---|---|
| Tabel `images` di `panelbuilder.db` | byte gambar (BLOB) — sumber sebenarnya |
| IndexedDB browser | cache lokal + tempat simpan saat server mati |
| `kv.library` | hanya penanda `hasImage` + `imgVersion` (~1 KB total) |
| localStorage | proyek + settings saja (~50 KB) |

Alurnya: unggah → disusutkan ke maks 360 px → masuk IndexedDB → `PUT /api/image/<key>`.
Kalau server mati, gambar ditandai *pending* dan otomatis diunggah saat server
muncul lagi. Render memakai `api/image/<key>?v=<imgVersion>`, jadi browser
meng-cache tiap gambar terpisah (ETag + 304).

Versi lama menyimpan data URI di dalam `kv.library`. Migrasi berjalan otomatis
sekali saat `npm start` — gambar dipindah ke tabel `images`, lalu `VACUUM`.
Pada database contoh: **5,49 MB → 2,22 MB**, dan `kv.library` 2992 KB → 1 KB.

Kenapa ini penting: dulu setiap penyimpanan menulis ulang seluruh library dan
mengirimnya utuh ke server, sementara localStorage (kuota ~5–10 MB, dihitung
UTF-16 alias 2 byte/karakter) akan penuh sekitar gambar ke-29 — dan `setItem`
yang gagal membatalkan penyimpanan ke database juga, tanpa pesan apa pun.
Sekarang payload sync **0,2 KB** dan 20× penyimpanan hanya menambah puluhan KB.

Batas: 2 MB per gambar (`MAX_IMAGE_BYTES`), tipe PNG/JPEG/WebP/GIF/SVG.

## Backup
Cukup salin file `panelbuilder.db`. (Mode WAL: salin saat server berhenti,
atau gunakan `sqlite3 panelbuilder.db ".backup backup.db"`.)

## Menambah jenis PLC
Dropdown PLC dibangun dari library — tidak ada daftar terpisah lagi. Cara
menambah CPU baru: **Components library → + Komponen baru**, isi dimensi & part
number, centang **"Ini CPU / PLC"**, lalu isi DI/DO bawaan dan batas modul
ekspansi. CPU itu langsung muncul di dropdown Panel designer.

11 CPU sudah tersedia (Mitsubishi FX5U/FX5UJ, Siemens S7-1200, Omron CP1E,
Delta DVP-ES2, Schneider M221, Allen-Bradley Micro850). Mengganti CPU benar-benar
mengubah desain: part number di BOM, footprint di layout, beban 24 V, jumlah
modul ekspansi (I/O bawaan dihitung lebih dulu), dan batas bus.

CPU non-Mitsubishi memakai modul ekspansi generik (`EXP-DI16` dst) dan memunculkan
peringatan `EXP_GENERIC` — edit komponen itu untuk memasukkan part number vendor.

## Menggeser komponen
- **Front cover** — tarik ke mana saja, snap 5 mm.
- **Dalam panel** — tarik kiri/kanan dengan langkah **2 mm**, jadi jarak antar
  komponen boleh sampai 0 mm. Naik/turun **selalu snap ke garis DIN rail**, jadi
  menggeser vertikal berarti memindahkan komponen ke rail lain, bukan
  menggantung di antaranya. Filter fan tidak bisa digeser (menempel di
  pintu/samping).
- Jarak 0 mm diizinkan, tapi kalau komponen benar-benar bertumpuk muncul
  peringatan `PLATE_OVERLAP` dengan tag komponennya.
- **Reset posisi** mengembalikan tab yang sedang aktif ke tata letak otomatis.

## Terminal block
Terminal yang dipakai disimpan sebagai komponen di **RAIL 4 · TERMINAL BLOCKS**
(sebelumnya hanya ada rail incoming/power, control, dan drives). Tambahkan dari
Components library → tab **Terminal block** → + Panel (default ke Rail 4).
Tersedia 12 jenis: UT 2,5 / 4 / 6 / 10 / 16, PE, netral, double-level, berfuse,
disconnect, end clamp, partition plate.

Selama rail 4 masih kosong, BOM memakai perkiraan otomatis dari jumlah titik
terminal. Begitu kamu memilih terminal sendiri, perkiraan itu **dimatikan** supaya
tidak double-count, dan kalau jumlah terpasang kurang dari kebutuhan desain muncul
peringatan `TERMINALS_SHORT`.

## Ukuran gambar
Lihat [ASSET-LIST.md](ASSET-LIST.md) — ukuran piksel untuk tekstur DIN rail
(200 × 280 px), wire duct (96 × 360 px), terminal strip (42 × 320 px), backplate
(400 × 400 px), dan tabel piksel per sprite komponen.

## Identitas perusahaan (Settings)
Isi nama, alamat, kontak, NPWP, nama engineer, dan logo di **Settings →
Identitas perusahaan**. Semua itu masuk kop **Report PDF** dan **Layout PDF**,
jadi dokumen yang keluar formal dan bukan lagi ber-brand aplikasi. Logo disimpan
di database (key `__company_logo`) seperti gambar komponen, jadi ikut terbawa ke
komputer lain. Catatan kaki dokumen juga bisa diatur.

## Format PDF: satu halaman per layout
Tiap gambar layout dapat **satu halaman penuh** dan tidak pernah terpotong:
skalanya dibatasi lebar **dan tinggi** halaman. Dulu hanya lebar yang dibatasi,
jadi panel portrait (mis. 600 × 1000 mm) jadi ~1080 px, pecah di tengah, dan
sisanya muncul sebagai kotak kosong di halaman berikutnya.

Urutan: ringkasan engineering → backplate → front cover → right side → left
side → skedul koordinat → BOM → catatan & asumsi. Setiap halaman membawa kop
sendiri supaya lembar yang dipisah tetap bisa dibaca.

Dua jenis halaman:
- `.pdf-page` — gambar layout. Wajib muat satu halaman (`break-inside:avoid`).
- `.pdf-flow` — tabel panjang (skedul, BOM). Mulai di halaman baru tapi boleh
  mengalir; header tabel terulang tiap halaman lewat `<thead>`.

Layout PDF mengikuti pola yang sama, tanpa halaman kalkulasi.

> Header/footer bawaan browser (URL + judul halaman) bukan bagian dokumen ini.
> Matikan di dialog print: **More settings → Headers and footers**.

## Tukar-menukar library antar pengguna
**Components library → Export** membuka dialog untuk memilih komponen mana yang
mau dibagikan. Yang tercentang awal adalah komponen **custom** dan yang **kamu
ubah** — biasanya itu yang berguna untuk orang lain. Ada opsi menyertakan gambar
(file jadi lebih besar, tapi penerima langsung dapat gambarnya). Hasilnya file
JSON `panel-builder-library-<tanggal>.json`.

**Import** membaca file itu, memvalidasinya, lalu menampilkan pratinjau: berapa
komponen baru, berapa yang akan ditimpa, berapa gambar, dan apa yang dilewati —
sebelum ada yang berubah. Kalau ada yang bertabrakan, bisa pilih *lewati yang
sudah ada*. Komponen bawaan yang tertimpa tetap bisa dikembalikan lewat tombol
**Reset** di kartunya.

Yang diekspor adalah **snapshot lengkap**, bukan hanya selisih dari bawaan —
supaya komponen tetap utuh di aplikasi penerima yang mungkin punya nilai bawaan
berbeda. Importer menolak file dengan format/versi yang tidak dikenal, membuang
field yang tidak ada di daftar putih (jadi file dari luar tidak bisa menyuntikkan
apa pun), memaksa tipe angka/boolean, dan melewati komponen yang dimensinya tidak
valid. CPU tanpa I/O bawaan diturunkan dari status PLC supaya tidak merusak
hitungan modul ekspansi.

## Catatan navigasi
- **AI design review** hanya tampil di Panel designer — isinya membahas layout
  yang sedang digambar, jadi di halaman lain hanya menghalangi.
- **Layout generator** kini bagian dari **Settings** (bukan menu sidebar
  sendiri), karena isinya parameter global yang jarang diubah. Tautan lama
  `#layoutgen` otomatis diarahkan ke Settings.

## Dashboard
Tiga kartu: **Projects**, **Customers** (unik, mengabaikan yang kosong), dan
**Library aktif** — jumlah komponen yang benar-benar terpakai di seluruh proyek
(hasil layout otomatis + yang ditambahkan lewat + Panel), dibanding total
komponen di library. Kartu Terminal points dan Asset readiness dihapus.

Kartu **Perusahaan** menampilkan logo dan identitas dari Settings; kalau belum
diisi, dia menunjuk ke Settings.

Nama proyek aktif di topbar hanya tampil di **Panel designer** — di halaman lain
diganti judul aplikasi, karena di sana nama itu menyesatkan (yang ditampilkan
bukan konteks halamannya). Daftar proyek tetap menandai yang aktif dengan badge
**Active** dan garis biru di tepi baris.
