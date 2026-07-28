# Daftar aset gambar & ukuran piksel

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

### Wire duct — `assets/textures/wire-duct-45.png`

Tinggi elemen mengikuti setelan **Tinggi duct** (default 45 mm, rentang 30–80 mm),
jadi tekstur ini ikut melar. Buat pada tinggi default; pitch sirip duct ~12 mm.

> **96 × 360 px** (12 mm × 45 mm @ 8 px/mm) · PNG · seamless horizontal

Kalau kamu banyak memakai duct 60 mm, sediakan juga `wire-duct-60.png`
(96 × 480 px) — tapi CSS saat ini hanya memuat satu file, jadi cukup yang 45 mm
dan biarkan diskalakan.

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

Contoh dari database saat ini:

| Komponen | mm (W × H) | Piksel @ 6× |
|---|---|---|
| PLC FX5U-32M | 150 × 90 | 900 × 540 |
| PLC FX5U-64M | 220 × 90 | 1320 × 540 |
| Power supply 20 A | 97 × 130 | 582 × 780 |
| MCCB 3P | 75 × 130 | 450 × 780 |
| VFD 2,2 kW | 108 × 128 | 648 × 768 |
| Servo MR-J4 | 85 × 168 | 510 × 1008 |
| Contactor | 45 × 77 | 270 × 462 |
| Interface relay | 15 × 80 | 90 × 480 |
| Terminal UT 2,5 | 5,2 × 47 | **31 × 282** |
| Terminal UT 6 | 8,2 × 52 | 49 × 312 |
| E-stop Ø40 | 60 × 60 | 360 × 360 |
| Pushbutton Ø22 | 29 × 29 | 174 × 174 |
| HMI 7" | 202 × 148 | 1212 × 888 |
| Filter fan 150 | 150 × 150 | 900 × 900 |

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
