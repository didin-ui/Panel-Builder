# Daftar aset gambar & ukuran piksel

## Struktur folder

Buat persis seperti ini di samping `index.html`. Nama file **case-sensitive**
kalau nanti di-host di Linux, jadi pakai huruf kecil semua.

```
Panel_builder_Assistant/
├── index.html
└── assets/
    ├── textures/          ← 4 file, di-tile (bagian berikutnya)
    │   ├── din-rail.png            200 × 280 px
    │   ├── wire-duct.png            96 × 360 px
    │   ├── terminal-strip.png       42 × 320 px
    │   └── backplate.png           400 × 400 px
    ├── components/        ← 79 file sprite (tabel di bawah)
    │   ├── plc-fx5u-32m.png
    │   ├── mccb-3p-40a.png
    │   └── …
    └── ui/                ← opsional, branding
        ├── logo.svg                tinggi 32 px (sidebar) & 40 px (laporan)
        ├── favicon.png             32 × 32 px
        └── avatar.png              60 × 60 px (dipotong bulat)
```

Semua sudah punya fallback: file yang belum ada tidak menyebabkan error, hanya
tampil sebagai kotak bergaris putus-putus. Jadi kamu bisa mengisi bertahap —
mulai dari 4 tekstur, karena itu yang paling mengubah kesan realistis.

## Aturan dasar

Gambar digambar pada skala **1 px CSS = 1 mm** saat zoom 100%. Zoom bisa sampai
2×, dan laporan mengecilkan gambar ke ~1:3. Supaya tetap tajam di dua ujung itu:

| Jenis aset | Kerapatan | Alasan |
|---|---|---|
| Sprite komponen | **6 px/mm** | tajam sampai zoom 2×, masih ringan |
| Tekstur berulang (rail, duct, terminal) | **8 px/mm** | ikut diskalakan `background-size`, butuh cadangan |
| Backplate / pattern | 8 px/mm | area besar, artefak paling kelihatan |

Rumusnya: `piksel = mm × kerapatan`.

---

## Tekstur berulang — inilah yang kamu tanyakan

Ketiga tekstur ini **di-tile horizontal** dan tingginya diskalakan penuh ke
elemen (`background-size: auto 100%`). Jadi yang wajib benar: **tinggi** harus
sesuai tinggi elemen, dan **lebar** harus satu unit ulangan yang sambungannya
mulus (seamless) di kiri–kanan.

### DIN rail — `assets/textures/din-rail.png`

Elemen digambar 35 mm tinggi (rail TS35). Pitch lubang rail standar 25 mm.

> **200 × 280 px** (25 mm × 35 mm @ 8 px/mm) · PNG · seamless horizontal

Satu file = satu ulangan: satu lubang oval di tengah, tepi atas/bawah rata.
Kalau mau lebih halus, pakai kelipatan utuh: 400 × 280 (2 lubang) atau
600 × 280 (3 lubang). Jangan ukuran non-kelipatan — sambungannya akan terlihat.

### Wire duct — `assets/textures/wire-duct.png`

Tinggi elemen mengikuti setelan **Tinggi duct** (default 45 mm, rentang 30–80 mm),
jadi tekstur ini ikut melar. Buat pada tinggi default; pitch sirip duct ~12 mm.

> **96 × 360 px** (12 mm × 45 mm @ 8 px/mm) · PNG · seamless horizontal

Namanya sengaja **tanpa angka**: satu file ini dipakai untuk semua tinggi duct.
Jangan beri nama `wire-duct-45.png` — dulu memang begitu, dan itu menyesatkan
karena file yang sama juga melayani duct 30 mm maupun 80 mm.

### Terminal strip — `assets/textures/terminal-strip.png`

Band terminal 40 mm tinggi, pitch UT 2,5 = 5,2 mm.

> **42 × 320 px** (5,2 mm × 40 mm @ 8 px/mm) · PNG · seamless horizontal

Catatan: band ini hanya tampil selama kamu **belum** memilih terminal block di
RAIL 4. Begitu terminal dipilih dari library, yang digambar adalah sprite
terminal aslinya, bukan tekstur ini.

### Backplate — `assets/textures/backplate.png`

Di-tile dua arah pada `background-size: 400px`.

> **400 × 400 px** · PNG · seamless dua arah (horizontal **dan** vertikal)

---

## Sprite komponen — `assets/components/<file>.png`

Ukuran per komponen = **dimensi mm × 6**, latar **transparan**, tampak depan,
tanpa bayangan (bayangan ditambahkan CSS). Nama file ada di field `asset` tiap
komponen; ukuran mm-nya tampil di kartu Components library.

Daftar lengkap — **inilah nama file yang dicari kode**, jadi pakai persis ini:

**Control**

| File | mm (W × H) | Piksel @ 6× |
|---|---|---|
| `ammeter-96.png` | 96 × 96 | 576 × 576 |
| `analog-module-4ad.png` | 40 × 90 | 240 × 540 |
| `analog-module-4da.png` | 40 × 90 | 240 × 540 |
| `beacon.png` | 70 × 70 | 420 × 420 |
| `buzzer.png` | 29 × 29 | 174 × 174 |
| `exp-module-16di.png` | 45 × 100 | 270 × 600 |
| `exp-module-16do.png` | 45 × 100 | 270 × 600 |
| `exp-module-4ai.png` | 45 × 100 | 270 × 600 |
| `exp-module-4ao.png` | 45 × 100 | 270 × 600 |
| `hmi-10in.png` | 272 × 214 | 1632 × 1284 |
| `hmi-4in.png` | 130 × 105 | 780 × 630 |
| `hmi-7in.png` | 202 × 148 | 1212 × 888 |
| `hour-meter.png` | 48 × 48 | 288 × 288 |
| `io-module-16di.png` | 40 × 90 | 240 × 540 |
| `io-module-16do.png` | 40 × 90 | 240 × 540 |
| `lamp-amber.png` | 29 × 29 | 174 × 174 |
| `lamp-blue.png` | 29 × 29 | 174 × 174 |
| `lamp-green.png` | 29 × 29 | 174 × 174 |
| `lamp-red.png` | 29 × 29 | 174 × 174 |
| `lamp-white.png` | 29 × 29 | 174 × 174 |
| `pb-black.png` | 29 × 29 | 174 × 174 |
| `pb-blue.png` | 29 × 29 | 174 × 174 |
| `pb-green.png` | 29 × 29 | 174 × 174 |
| `pb-lit-green.png` | 29 × 29 | 174 × 174 |
| `pb-lit-red.png` | 29 × 29 | 174 × 174 |
| `pb-mushroom.png` | 60 × 60 | 360 × 360 |
| `pb-red.png` | 29 × 29 | 174 × 174 |
| `pb-yellow.png` | 29 × 29 | 174 × 174 |
| `plc-cp1e-30.png` | 130 × 90 | 780 × 540 |
| `plc-dvp32es.png` | 150 × 90 | 900 × 540 |
| `plc-fx5u-32m.png` | 150 × 90 | 900 × 540 |
| `plc-fx5u-64m.png` | 220 × 90 | 1320 × 540 |
| `plc-fx5u-80m.png` | 285 × 90 | 1710 × 540 |
| `plc-fx5uj-40m.png` | 130 × 90 | 780 × 540 |
| `plc-fx5uj-60m.png` | 150 × 90 | 900 × 540 |
| `plc-m221.png` | 110 × 90 | 660 × 540 |
| `plc-micro850.png` | 130 × 90 | 780 × 540 |
| `plc-s7-1212c.png` | 90 × 100 | 540 × 600 |
| `plc-s7-1214c.png` | 110 × 100 | 660 × 600 |
| `potentiometer.png` | 29 × 29 | 174 × 174 |
| `power-meter-96.png` | 96 × 96 | 576 × 576 |
| `selector-2pos.png` | 29 × 29 | 174 × 174 |
| `selector-3pos.png` | 29 × 29 | 174 × 174 |
| `selector-key.png` | 29 × 29 | 174 × 174 |
| `temp-ctrl-48.png` | 48 × 48 | 288 × 288 |
| `voltmeter-96.png` | 96 × 96 | 576 × 576 |

**Cooling**

| File | mm (W × H) | Piksel @ 6× |
|---|---|---|
| `cooling-fan-150.png` | 150 × 150 | 900 × 900 |
| `outlet-filter-150.png` | 150 × 150 | 900 × 900 |

**Drives**

| File | mm (W × H) | Piksel @ 6× |
|---|---|---|
| `servo.png` | 85 × 168 | 510 × 1008 |
| `vfd.png` | 108 × 128 | 648 × 768 |

**Mechanical**

| File | mm (W × H) | Piksel @ 6× |
|---|---|---|
| `door-lock.png` | 30 × 30 | 180 × 180 |
| `window.png` | 200 × 150 | 1200 × 900 |

**Network**

| File | mm (W × H) | Piksel @ 6× |
|---|---|---|
| `ethernet-switch-8p.png` | 52 × 135 | 312 × 810 |
| `port-rj45.png` | 29 × 29 | 174 × 174 |
| `port-usb.png` | 29 × 29 | 174 × 174 |

**Power**

| File | mm (W × H) | Piksel @ 6× |
|---|---|---|
| `psu-24vdc.png` | 97 × 130 | 582 × 780 |
| `socket.png` | 50 × 50 | 300 × 300 |

**Protection**

| File | mm (W × H) | Piksel @ 6× |
|---|---|---|
| `mcb-1p.png` | 18 × 90 | 108 × 540 |
| `mcb-3p.png` | 54 × 90 | 324 × 540 |
| `mccb-3p-40a.png` | 75 × 130 | 450 × 780 |
| `spd-3p-385v.png` | 72 × 90 | 432 × 540 |
| `thermal-overload.png` | 45 × 70 | 270 × 420 |

**Safety**

| File | mm (W × H) | Piksel @ 6× |
|---|---|---|
| `estop-40.png` | 60 × 60 | 360 × 360 |
| `estop-key.png` | 60 × 60 | 360 × 360 |
| `safety-relay.png` | 22.5 × 99 | 135 × 594 |

**Switching**

| File | mm (W × H) | Piksel @ 6× |
|---|---|---|
| `contactor.png` | 45 × 77 | 270 × 462 |
| `disconnect.png` | 65 × 65 | 390 × 390 |
| `interface-relay.png` | 15 × 80 | 90 × 480 |

**Terminals**

| File | mm (W × H) | Piksel @ 6× |
|---|---|---|
| `tb-2level.png` | 5.2 × 62 | 31 × 372 |
| `tb-disconnect.png` | 6.2 × 57 | 37 × 342 |
| `tb-endclamp.png` | 9.5 × 40 | 57 × 240 |
| `tb-fuse.png` | 8.2 × 62 | 49 × 372 |
| `tb-n.png` | 6.2 × 47 | 37 × 282 |
| `tb-partition.png` | 2.2 × 52 | 13 × 312 |
| `tb-pe.png` | 6.2 × 47 | 37 × 282 |
| `tb-ut10.png` | 10.2 × 57 | 61 × 342 |
| `tb-ut16.png` | 12.2 × 62 | 73 × 372 |
| `tb-ut2.5.png` | 5.2 × 47 | 31 × 282 |
| `tb-ut4.png` | 6.2 × 47 | 37 × 282 |
| `tb-ut6.png` | 8.2 × 52 | 49 × 312 |

Sprite terminal sangat sempit (31 px) — itu normal, karena yang digambar adalah
**satu pole**. Puluhan terminal berjejer membentuk strip.

Perangkat bulat (pushbutton, lampu, E-stop, selector) sudah di-mask bulat oleh
CSS, jadi gambarnya boleh kotak dengan sudut transparan.

---

## Cara mengganti

Taruh file dengan nama yang sama di folder yang sesuai — tidak perlu ubah kode.

Kalau ingin gambar **ikut tersimpan ke database dan terbawa ke komputer lain**,
jangan pakai file: buka **Components library → Edit → Gambar komponen** dan
unggah dari sana. Gambar itu disusutkan ke maks 360 px, masuk tabel `images`, dan
menimpa file `assets/` untuk komponen tersebut. File di `assets/` hanya jadi
fallback bawaan repo.

Konsekuensinya: untuk tekstur rail/duct/terminal **harus** lewat file `assets/`,
karena tekstur bukan komponen dan tidak ada di library.

## Status saat ini

Folder `assets/` belum ada di repo, jadi semua sprite tampil sebagai kotak
bergaris putus-putus dan tekstur jatuh ke warna solid. Itu tidak mengganggu
perhitungan — hanya tampilan. Dashboard menampilkan indikator berapa sprite yang
sudah terpasang.
