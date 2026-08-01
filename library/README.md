# Library siap pakai

File JSON di folder ini bisa langsung di-import lewat
**Components library → Import** (tombol di kanan atas, antara *Export* dan
*+ Tambah komponen*).

Folder ini **tidak** dilayani lewat HTTP — ia di luar `public/`. Buka lewat
dialog file, bukan lewat URL.

| File | Isi | Jumlah |
|---|---|---|
| `autonics-temperature-controller.json` | Autonics — temperature controller panel-mount | 34 |
| `haiwell-plc-hmi.json` | Haiwell — PLC, modul ekspansi, HMI | 32 |
| `meanwell-psu.json` | MEAN WELL — power supply 24 VDC rel DIN | 27 |
| `omron-plc-hmi-psu.json` | Omron — PLC, HMI, power supply | 33 |
| `weintek-hmi.json` | Weintek — HMI dan gateway | 15 |
| `siemens-plc-hmi.json` | Siemens — PLC dan HMI | 27 |

Semua tanpa gambar — kartunya menampilkan placeholder sampai kamu unggah
gambar sendiri lewat **Edit**. Key-nya diberi awalan per brand
(`mw_`, `om_`, `si_`, `wt_`, `hw_`, `autonics_`) supaya tidak pernah bentrok
satu sama lain maupun dengan komponen bawaan.

---

## Yang harus kamu periksa sebelum membeli

**Setiap entri ditandai `dimsVerified: false`.** Badge **dims ✓** tidak akan
muncul sampai kamu sendiri mencentangnya setelah cek datasheet. Angka di sini
cukup untuk menyusun layout dan menghitung ukuran panel — bukan pengganti
lembar data.

Yang paling bisa dipercaya: **ukuran muka HMI dan controller panel-mount**
(mengikuti cutout standar) dan **rating arus PSU** (mengikuti penamaan
pabrikannya sendiri — DR-60-24 memang 60 W / 24 V = 2,5 A).

Yang paling perlu dicek ulang: **kedalaman**, dan **lebar modul PLC**.

**Part number di sini adalah nama model, bukan kode pesan lengkap.** Banyak
pabrikan menambahkan sufiks tegangan/output saat pemesanan. Lengkapi lewat
**Edit** kalau sudah ditentukan.

---

## Catatan per brand

### MEAN WELL — `meanwell-psu.json`

27 model 24 VDC dari seri HDR, DR, NDR, SDR, EDR dan TDR (0,63 A – 40 A).

`psuA` diisi, jadi supply ini **benar-benar ikut menghitung kapasitas 24 V**:
tambahkan satu ke rail 1 dan utilisasi PSU langsung memakai kapasitas itu.

> Menambahkan PSU eksplisit **menggantikan** slot PSU otomatis, bukan menumpuk
> di atasnya. Itu memang disengaja — kamu memilih supply-nya sendiri. Untuk
> kapasitas ganda atau cadangan N+1, tambahkan dua unit; engine menjumlahkan
> kapasitasnya dan melaporkan utilisasi kalau satu unit mati.

TDR adalah seri input **3 fasa** — pastikan itu memang yang kamu mau.

### Omron — `omron-plc-hmi-psu.json`

- **PSU** seri S8VK-C / S8VK-G / S8VK-S (2,5 A – 40 A), `psuA` terisi.
- **PLC** CP1E, CP1L, CP2E dan NX1P2 — semuanya punya I/O onboard, jadi bisa
  dipilih sebagai CPU proyek di dropdown PLC.
- **HMI** NB dan NA series.

### Siemens — `siemens-plc-hmi.json`

- **S7-1200** (CPU 1211C–1217C) dan **S7-200 SMART** (ST/SR 20–60) punya I/O
  onboard, jadi muncul di dropdown PLC. **LOGO! 8** juga.
- **S7-1500** (CPU 1511/1513/1515/1516) sengaja **tidak** ditandai sebagai CPU
  yang bisa dipilih: seri ini tidak punya I/O onboard sama sekali, I/O-nya
  lewat ET 200SP/MP. Kalau dijadikan CPU proyek, hitungan modul ekspansi jadi
  ngawur. Ia tetap ada di library sebagai komponen yang bisa ditaruh di rail.
- **HMI** Basic panel (KTP) dan Comfort panel (TP).

### Weintek — `weintek-hmi.json`

HMI seri iP, iE dan cMT X (4,3" – 15,6"), plus `cMT-SVR-102` dan `cMT-G04`
yang **bukan** panel berlayar — keduanya box rel DIN, jadi `mount: 'rail'`.

### Haiwell — `haiwell-plc-hmi.json`

PLC seri C dan T, modul ekspansi S-series, dan HMI seri B dan C.

> **Brand ini yang paling perlu kamu verifikasi.** Dokumentasi Haiwell yang
> beredar lebih sedikit dibanding empat brand lain di sini, jadi dimensi dan
> penamaan modelnya lebih rentan meleset. Cek ke datasheet atau ukur unit
> fisiknya sebelum dipakai untuk drilling plan.

### Autonics — `autonics-temperature-controller.json`

7 seri, 34 model. Sufiks Autonics menentukan ukuran muka dan itu mengikuti
cutout DIN standar:

| Sufiks | Muka (L × T) | Cutout | |
|---|---|---|---|
| `S` | 48 × 48 | 45 × 45 | 1/16 DIN |
| `M` | 72 × 72 | 68 × 68 | |
| `L` | 96 × 96 | 92 × 92 | 1/4 DIN |
| `H` | 96 × 48 | 92 × 45 | 1/8 DIN mendatar |
| `W` | 48 × 96 | 45 × 92 | 1/8 DIN tegak |
| `Y` | 72 × 36 | 68 × 33 | |
| `SP` / `N` | 48 × 24 | 45 × 22 | 1/32 DIN |

Kedalaman 80 mm seragam — ruang yang dicadangkan, bukan angka datasheet.

`powerW` sengaja **0**: seri ini standarnya 100–240 VAC, jadi tidak membebani
PSU 24 V sama sekali. Untuk varian 24 VAC/VDC, ubah ke ±5 W lewat **Edit**.

---

## Tentang `powerW`

`powerW` adalah **konsumsi 24 V**, bukan daya total perangkat.

- Perangkat 100–240 VAC (temperature controller, sebagian PLC, PSU itu
  sendiri) → **0**. Mengisinya dengan angka akan menggelembungkan anggaran
  24 V dan membuat engine memilih PSU lebih besar dari yang perlu.
- HMI dan perangkat 24 VDC → diisi konsumsi wajarnya.
