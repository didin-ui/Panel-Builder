# Panel Builder Assistant — Menjalankan dengan Database

## Kebutuhan
Node.js 18+ (cek: `node -v`)

## Struktur
| File | Isi |
|---|---|
| `public/engine.js` | Semua kalkulasi & pemilihan komponen. Murni, tanpa DOM, tanpa dependency. |
| `public/index.html` | UI + render. Tidak menghitung apa pun sendiri. |
| `public/assets/` | Gambar komponen dan tekstur. |
| `server.js` | API penyimpanan (Express + SQLite). Di luar `public/`, jadi tidak ikut dilayani. |
| `test/engine.test.js` | 280 assertion, jalankan `npm test`. |
| `ASSET-LIST.md` | Ukuran piksel semua gambar & tekstur. |
| `ENGINEERING.md` | Dasar perhitungan: rumus, konstanta, standar, dan batasannya. |

`engine.js` bisa dipakai sendiri tanpa browser:
```js
const {compute, DEFAULT_CFG} = require('./public/engine.js');
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
"● Database connected". Semua proyek tersimpan di file `panelbuilder.db` (SQLite)
di folder yang sama, dan otomatis dipanggil kembali setiap aplikasi dibuka.

### Yang dilayani lewat HTTP
Hanya isi folder `public/`. Sebelumnya server memasang `express.static(__dirname)`
sehingga `panelbuilder.db` — seluruh proyek dan data customer — bisa diunduh siapa
pun yang menjangkau port ini, begitu juga setiap backup `*.db`, `server.js` dan
`package.json`. Kalau menaruh file di folder proyek, taruh di `public/` **hanya**
kalau memang boleh dibaca publik.

### Terikat ke localhost
Server mendengarkan di `127.0.0.1` saja, karena aplikasi ini **belum punya
autentikasi apa pun**: `/api/projects` bisa dibaca, ditulis dan dihapus tanpa
kredensial. Untuk dipakai bersama satu tim:
```
HOST=0.0.0.0 npm start
```
Itu keputusan sadar — lakukan hanya di jaringan yang ente percaya, dan pasang
autentikasi sebelum dipakai di luar itu.

## Mode tanpa server
`public/index.html` tetap bisa dibuka langsung (double-click) tanpa `npm start` —
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
  Tombol **DWG / DXF / STEP** dihapus: itu placeholder yang tidak melakukan
  apa-apa. Tombol yang tidak berfungsi lebih buruk daripada tidak ada tombol —
  orang merencanakan pekerjaannya dengan asumsi fitur itu tersedia. Export CAD
  butuh backend tersendiri; kalau dibuat nanti, tombolnya kembali.
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
  Tombol **Tambah komponen** di Panel designer — di kolom kiri, antara
  **Generate panel** dan **Save project** — membuka modal yang sama, tapi
  komponennya dipilih di situ juga — jadi tidak perlu bolak-balik ke menu
  Components library hanya untuk menambah satu terminal. Keduanya memakai satu
  fungsi yang sama, supaya aturan penempatan dan penggabungan jumlah tidak
  perlu dijaga di dua tempat.
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

### Yang menentukan sebuah komponen "punya gambar"

**Keberadaan byte-nya**, bukan penanda di dalam library. Saat terhubung, klien
membaca `GET /api/images` (dan key IndexedDB) ke sebuah indeks; `imgSrc()`
memakai indeks itu.

Dulu satu-satunya penanda adalah `hasImage` di dalam override library, dan itu
salah tempat: penanda tidak ikut byte-nya, ia ikut override — jadi setiap jalur
yang mengganti override menghapusnya sekalian. Import library melakukan persis
itu (`components[k] = Object.assign({}, ...)`), sehingga komponen yang gambarnya
sudah diunggah tapi tidak ikut di file import kehilangan penandanya sementara
byte-nya tetap tinggal di database.

Akibatnya bukan kotak kosong yang jujur, tapi lebih buruk: `imgSrc` jatuh ke
`assets/components/<asset>.png` yang tidak ada di instalasi ini, jadi `<img>`-nya
404, `onload` tidak pernah jalan, dan placeholder-nya tetap terlihat — persis
seperti gambarnya memang belum pernah diunggah. Di `panelbuilder.db` nyata:
**59 gambar tersimpan, hanya 26 yang masih bertanda** — 33 gambar utuh tapi
tak terlihat, termasuk FX5-4AD.

Selama ini tertutupi karena `hydrateImages()` memuat SEMUA gambar dari
IndexedDB saat startup, jadi `blobUrls` menambalnya. Begitu hidrasi dibuat
malas (demi memori — lihat bagian Skala), tambalan itu hilang dan bug lamanya
muncul. Tidak ada data yang hilang; yang hilang hanya penandanya.

Penanda `hasImage` masih ditulis untuk kompatibilitas, tapi tidak ada lagi yang
bergantung padanya sendirian. Cache-buster memakai versi terbaru antara indeks
dan komponen, supaya browser tidak menyajikan gambar usang.

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

## Skala: pertumbuhan proyek & library

Diukur dengan server dan engine sungguhan, bukan taksiran. Kolom node & `<img>`
itu hitungan eksak dari DOM.

Yang **tidak** jadi masalah — 500 proyek + 1000 komponen library:

| | angka |
|---|---|
| payload tiap kali simpan | 882 KB |
| tulis ke SQLite | 38 ms |
| `GET /api/state` saat aplikasi dibuka | 36 ms |
| localStorage terpakai | 0,86 MB (kuota browser ±5 MB) |
| file database | 1,6 MB |

Volume datanya sendiri sehat. Yang patah justru render.

**Halaman Projects dulu melambat kuadratik.** `plcLabel()` memanggil `libDb()`
per baris, dan `libDb()` menyalin seluruh `COMPONENT_DB` plus tiap override —
jadi biayanya proyek × library. 1000 proyek + 2000 komponen = 2 juta penyalinan
objek untuk satu render. `libDb()` sekarang di-cache, dan dihitung sekali per
render.

Cache-nya punya dua pengaman karena cache basi adalah kegagalan senyap:
identitas objek (menangkap penggantian library dari server/import) dan
`invalidateLibDb()` (menangkap perubahan di tempat). Ada tes statis yang gagal
kalau ada baris baru menyentuh `state.library.components` tanpa invalidasi.

**Daftar panjang dibatasi, tapi tidak diam-diam.** Projects 100 baris,
Components library 240 kartu. Jumlah sebenarnya tetap ditulis dan ada tombol
**Tampilkan semua** — membatasi tanpa memberi tahu berarti user mengira
proyeknya hilang.

**Gambar library `loading="lazy"`.** Dulu membuka library dengan 2000 komponen
memicu 2000 request ke `/api/image`. Gambar di gambar panel sengaja tetap
eager: lazy bisa membuat gambar kosong saat dicetak.

> **Jangan gabungkan `loading="lazy"` dengan menyembunyikan gambarnya sampai
> `onload`.** Gambar `display:none` tidak pernah dimuat browser — ia tidak
> dirender, jadi tidak pernah dianggap mendekati viewport, jadi `onload` tidak
> pernah jalan, jadi kelas yang memunculkannya tidak pernah ditambah. Saling
> mengunci, dan seluruh kartu library tampil kosong. Kartu library sekarang
> memasang `has-img` saat render — kita sudah tahu byte-nya ada dari indeks
> gambar — dan hanya MENCABUTNYA lewat `onerror`. Ada tes yang gagal kalau
> kombinasi itu muncul lagi di mana pun.

**Gambar tidak lagi dimuat semua saat startup.** `hydrateImages()` dulu menarik
setiap gambar dari IndexedDB jadi blob URL — 2000 gambar × ±140 KB ≈ 280 MB
ditahan di memori sebelum satupun dilihat, plus 2000 transaksi berurutan yang
membuat startup menggantung. Sekarang hanya key yang benar-benar digambar.

Hasilnya, pada 1000 proyek + 2000 komponen:

| | sebelum | sesudah |
|---|---|---|
| render Projects | 7389 ms | 67 ms |
| node tabel Projects | 15.011 | 1.516 |
| render Library | 1134 ms | 157 ms |
| node Library | 35.340 | 4.084 |
| `<img>` saat library dibuka | 2.000 (eager) | 221 (lazy) |

(Angka ms dari linkedom, jauh lebih lambat dari browser — baca perbandingannya,
bukan nilai absolutnya. Jumlah node dan `<img>` eksak.)

**Yang belum dibereskan:** `/api/sync` masih mengirim *seluruh* state tiap kali
simpan dan server menulis ulang setiap baris proyek. Pada 500 proyek itu 882 KB
dan 38 ms — masih nyaman, tapi tumbuh linear selamanya. Kalau sudah menyentuh
beberapa ribu proyek, ini yang perlu diganti jadi simpan per proyek.

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

## Library siap pakai

Folder [`library/`](library/) berisi file JSON yang bisa langsung di-import:
Autonics (temperature controller), Haiwell, MEAN WELL, Omron, Weintek dan
Siemens — 168 komponen, semuanya `dimsVerified: false`. Catatan per brand ada
di [library/README.md](library/README.md).

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
- **Popup Design review sudah dibuang.** Panel melayang di kanan bawah itu
  mengulang angka yang sudah ada di kartu **Power calculation** — PSU,
  utilisasi, panas, MCCB — dan menutupinya. Peringatan tetap ada di blok
  peringatan kartu Cabinet, dan ringkasan errornya tetap di toolbar bawah.
  Tidak ada informasi yang hilang, hanya tidak lagi ditampilkan dua kali.
  (Panel itu memang tidak pernah memakai model bahasa; isinya hitungan
  `engine.js`.)
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

## Beban bermotor
Menu Panel designer tidak lagi punya kolom VFD/Servo/Motors dengan rating tetap.
Sebagai gantinya ada **daftar beban**: tiap entri punya jenis (VFD / Servo /
Motor DOL), daya poros dalam kW, dan jumlah. Rating itu menentukan arus, ukuran
breaker & kabel, panas, **dan ukuran fisik drive di gambar** — VFD 5,5 kW itu
170 × 260 mm, bukan 108 × 128 mm seperti yang 2,2 kW.

Jadi panel dengan fan 5,5 kW + dua pompa 1,5 kW sekarang bisa dinyatakan apa
adanya. Dulu semuanya dianggap 2,2 kW.

Proyek lama tidak berubah: daftarnya disintesis dari hitungan lama memakai rating
asumsi yang dulu (2,2 kW / 750 W / 1,5 kW), sampai jumlah baris BOM-nya identik.
