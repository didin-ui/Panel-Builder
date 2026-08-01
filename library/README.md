# Library siap pakai

File JSON di folder ini bisa langsung di-import lewat
**Components library → Import**.

| File | Isi |
|---|---|
| `autonics-temperature-controller.json` | 34 temperature controller Autonics panel-mount, 7 seri |

Folder ini **tidak** dilayani lewat HTTP — ia di luar `public/`. Buka lewat
dialog file, bukan lewat URL.

---

## autonics-temperature-controller.json

7 seri, 34 model, tanpa gambar (kartu akan menampilkan placeholder sampai kamu
unggah gambarnya sendiri lewat **Edit**).

| Seri | Model | Keterangan |
|---|---|---|
| TC4 | S, M, L, H, W, Y, SP | PID / ON-OFF, tampilan tunggal |
| TK4 | S, M, L, H, W, N | PID auto-tuning, tampilan ganda |
| TCN4 | S, M, L, H | PID ekonomis, tampilan ganda |
| TZN4 | S, M, L, H, W | PID auto-tuning (seri lama) |
| TX4 | S, M, L, H, W | layar LCD grafis |
| T4 | M, L, W, Y | seri dasar (lama) |
| T3 | S, H, N | seri dasar kompak (lama) |

### Ukuran

Sufiks Autonics menentukan ukuran muka, dan itu mengikuti cutout DIN standar:

| Sufiks | Muka (L × T) | Cutout panel | |
|---|---|---|---|
| `S`  | 48 × 48 | 45 × 45 | 1/16 DIN |
| `M`  | 72 × 72 | 68 × 68 | |
| `L`  | 96 × 96 | 92 × 92 | 1/4 DIN |
| `H`  | 96 × 48 | 92 × 45 | 1/8 DIN mendatar |
| `W`  | 48 × 96 | 45 × 92 | 1/8 DIN tegak |
| `Y`  | 72 × 36 | 68 × 33 | |
| `SP` / `N` | 48 × 24 | 45 × 22 | 1/32 DIN |

### Yang perlu kamu periksa sebelum membeli

- **Ukuran muka boleh dipercaya** — itu cutout DIN standar, bukan tebakan.
- **Kedalaman 80 mm adalah ruang yang dicadangkan, bukan angka datasheet.**
  Seragam untuk semua model. Badan Autonics umumnya lebih pendek dari itu;
  80 mm memberi kelonggaran untuk terminal dan kabel di belakang pintu.
  Semua entri ditandai `dimsVerified: false`, jadi badge **dims ✓** tidak
  muncul sampai kamu sendiri mencentangnya setelah cek datasheet.
- **Part number di sini adalah nama seri**, bukan kode pesan lengkap. Kode
  pesan Autonics menambahkan sufiks input/output — misalnya `TK4S-14RN`.
  Isi kode lengkapnya lewat **Edit** kalau sudah ditentukan.

### `powerW` sengaja 0

Seri ini standarnya **100–240 VAC**, jadi tidak membebani PSU 24 V sama sekali.
Kalau diisi angka, anggaran 24 V ikut menggelembung dan PSU yang dipilih
aplikasi jadi lebih besar dari yang perlu.

Untuk varian **24 VAC/VDC**, ubah `powerW` ke sekitar 5 W lewat **Edit** —
saat itu barulah ia ikut dihitung.
