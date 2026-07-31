# Engineering basis

Every number the engine produces traces back to something on this page. If a
value is not here, it is not in the engine — that is the rule the code is held
to. All constants live in `ASSUMPTIONS` in [engine.js](engine.js) and can be
overridden per call: `compute(cfg, { psuMaxUtil: 0.6 })`.

> **Scope of confidence.** The *methods* below are standard practice. The
> *component data* (dimensions, part numbers) is engineering-grade estimate,
> flagged `dimsVerified: false`. Verify against the current vendor datasheet
> before purchase. There is no supplier feed, so the tool never reports stock or
> lead time — see [Deliberate omissions](#deliberate-omissions).

---

## 1. Load model

Each load is reduced to real input power and apparent power, then summed. The
system power factor is an **output**, not an input — the prototype's blanket
`PF = 0.85` is gone.

```
P_in = P_shaft / (η_drive · η_motor)      real power drawn from the supply
S    = P_in / PF                          apparent power
I    = S / (√3 · V)                       line current
```

Totals: `ΣP_in`, `ΣS`, `I_FLC = ΣS / (√3 · V)`, `PF_system = ΣP_in / ΣS`.

| Load | PF | η drive | η motor | Basis |
|---|---|---|---|---|
| VFD | 0.95 | 0.97 | 0.85 | Diode-rectifier front end has high displacement PF; small IE3 motor |
| Servo | 0.90 | 0.95 | 0.90 | Servo amplifier + permanent-magnet motor |
| Motor DOL | 0.82 | — | 0.80 | Typical 1.5 kW 4-pole induction motor |
| PSU (24 V) | 0.95 | 0.90 | — | Active PFC switch-mode supply |

### Daftar beban

Beban bermotor adalah **daftar**, bukan hitungan: `cfg.loads = [{kind, kW, qty}]`
dengan `kind` = `vfd` | `servo` | `dol`. Tiap entri punya ratingnya sendiri, dan
rating itulah yang menentukan arus, ukuran breaker, kabel, panas, **dan ukuran
fisik drive di layout**.

Sebelumnya `vfd: 3` berarti tiga VFD 2,2 kW — rating dipatok global
(`vfdKw 2.2`, `servoW 750`, `dolKw 1.5`), sehingga mesin dengan rating campur
tidak bisa dinyatakan sama sekali. Panel cooling tower dengan fan 5,5 kW dan dua
pompa 1,5 kW dihitung sebagai 3 × 2,2 kW: arus salah, breaker salah, kabel salah,
panas salah, dan footprint drive salah (5,5 kW itu 170 × 260 mm, bukan 108 × 128).

`vfd`, `servo` dan `motor` masih ada tapi **diturunkan** dari daftar — satu sumber
kebenaran. Hitungan yang dikirim bersamaan dengan `loads` diabaikan.

**Migrasi netral.** Proyek tanpa `loads` mensintesisnya dari hitungan lama memakai
rating asumsi di atas, jadi desainnya identik sampai ke jumlah baris BOM. Konstanta
`DEFAULT_RATING` sekarang hanya dipakai untuk migrasi itu.

### Pemilihan drive per rating

Tabel `[kW, part number]` per kelas tegangan, bukan formula — penomoran MR-JE tidak
seragam (750 W adalah `MR-JE-70A`, bukan `-75A`). Frame terkecil yang sanggup yang
dipilih; kalau ratingnya di antara frame, naik ke atasnya dan dilaporkan lewat
`DRIVE_FRAME`. Di atas frame terbesar → `DRIVE_OVER_RANGE`.

Ukuran fisik dikelompokkan per frame band (VFD: 3 band, servo: 3 band). Starter DOL
juga per rating — motor 5,5 kW mendapat LC1D18BD + LRD16, motor 1,5 kW mendapat
LC1D09BD + LRD08.

Karena satu panel bisa memuat beberapa model, key komponennya disintesis
(`vfd_400_5k5`, `contactor_LC1D18BD`) dengan `baseKey` menunjuk ke jenis aslinya.
Itu membuat gambar yang sudah kamu unggah untuk `vfd`/`contactor` tetap terpakai
sebagai cadangan, dan penandaan tag (T1, K1) tetap benar.

**Cross-check.** A 1.5 kW 400 V motor computes to 3.30 A; nameplate FLC for that
class is ~3.4 A. Good.

**Known conservatism gap.** VFD input current is computed from shaft power, which
gives 4.05 A for a 2.2 kW unit at 400 V. Datasheet rated input current is ~5.5 A
because it includes harmonic current the ideal calculation ignores. The ×1.25
breaker margin absorbs this for feeder sizing, but if you add harmonic filters or
size a transformer, use datasheet current instead.

### Starting current

Only DOL motors inrush; VFD and servo axes are soft-started by their drive.

```
I_start = I_FLC + (I_LR,largest − I_FLC,largest)     largest motor starting, rest running
I_LR    = I_FLC × 6.5                               IEC design N, 6–8× typical
```

This is the number that sizes a generator or upstream transformer. The prototype
did not compute it at all, despite PRD Module 6 asking for it.

---

## 2. 24 V DC budget

Split by **where the heat ends up** — this is what makes the thermal model
honest, and it removes the prototype's double-count (it charged solenoids twice,
once as `valve × 2` and again inside `do_ × 2`).

**Internal** (dissipates inside the enclosure → counts as thermal load):
PLC CPU 30 W · each expansion module 5 W · Ethernet switch 8 W · safety relay
4 W · interface relay coil 0.5 W · contactor coil 2 W · HMI 15 W (door-mounted,
still inside).

**External** (field devices, dissipate outside → excluded from thermal load):
DI field sensor 0.6 W each (PNP sensor ≈ 25 mA at 24 V) · solenoid pilot coil
2.5 W each.

Sized at 100% coincidence — no diversity credit, because the supply has to
survive the worst case.

### Power supply selection

```
I_required = I_load / (maxUtil · derate)
```

`psuMaxUtil = 0.70`, giving the ~30% spare the PRD asks for. `derate = 1.0` up to
45 °C, then −2%/K to a floor of 0.6 (QUINT-class behaviour). The smallest supply
in the ladder meeting `I_required` wins. Ladder: 5 / 10 / 20 / 40 A.

### Kapasitas mengikuti supply yang terpasang

Utilization dihitung terhadap **total kapasitas semua supply di panel**, bukan
terhadap satu unit hasil pemilihan otomatis. Sebelumnya supply tambahan tetap
digambar dan masuk BOM tapi kapasitasnya diabaikan, sehingga angka utilization
tidak pernah berubah walau unitnya ditambah — BOM bilang dua, hitungan bilang
satu.

Setiap komponen yang punya field `psuA` dihitung sebagai sumber 24 V. Katalog
yang tersedia: `psu_5a`, `psu_10a`, `psu_20a`, `psu_40a`. Memilih salah satunya
lewat **+ Panel** akan **mematikan pemilihan otomatis** — pilihanmu yang dipakai,
seperti terminal block di rail 4. Komponen `psu` sendiri adalah slot otomatis
itu, jadi menambahkannya berarti satu unit lagi dengan model yang sama.

**Asumsi yang perlu disadari:** kapasitas beberapa supply **dijumlahkan**, yang
benar kalau tiap supply memberi makan grup 24 V berbeda. Kalau maksudmu cadangan
N+1 (paralel lewat modul redundansi), kapasitasnya TIDAK boleh dijumlahkan.
Engine tidak bisa membedakan keduanya, jadi ia melaporkan **utilization saat satu
unit mati** begitu ada lebih dari satu supply — supaya pilihannya sadar, bukan
diasumsikan diam-diam.

Peringatan: `PSU_SHORT` (di atas 70% → warn, di atas 100% → error) dan
`PSU_MISSING` kalau panel tidak punya sumber 24 V sama sekali.

The prototype used `dcLoad/24 > 9 ? 20A : 10A`, which allowed 89% utilisation
before any derating.

---

## 3. Protection

All selections are table lookups from real frame/trip ranges, and the selected
part number is what reaches the BOM. The prototype computed
`ceil(peakA*1.25/8)*8*2` and then overrode it with a hardcoded "set 40 A".

| Device | Rule |
|---|---|
| Incoming MCCB | smallest trip ≥ `I_FLC × 1.25` (IEC 60204-1 §7.2.1 continuous duty) |
| Drives feeder MCB | smallest trip ≥ `ΣI_drives × 1.25` |
| Control MCB | `max(I_psu,ac × 1.25, 6 A)` — floored at C6 for switch-mode inrush |
| Contactor | smallest AC-3 frame with `kW ≥ motor kW` **and** `A ≥ I_FLC` |
| Overload | range must bracket `I_FLC`; set to `I_FLC` |

Frames: MCCB NF32-SV / NF63-CV / NF125-SV / NF250-SV. MCB trips 2…63 A.
Contactors TeSys LC1D09…D38 with **24 VDC coils** (`BD` suffix) so the whole
control system runs off the one 24 V rail — the prototype specified 220 VAC coils
while also fitting a 24 V supply and safety relay, needing an undeclared second
control voltage.

Instantaneous trip is assumed at the manufacturer default (~10× In for motor
circuits), which clears the computed starting current. **Not modelled:** discrimination
between incoming and outgoing devices, and short-circuit withstand — there is no
`Isc` input yet, so **Icu/Ics must be confirmed against the supply fault level
manually.**

---

## 4. Drive voltage class

The prototype specified `FR-D720` and `MR-JE-70A` — both **200 V-class** — while
calculating current at 400 V. Ordering that BOM for a 400 V supply destroys the
drives. Selection is now voltage-aware:

| Supply | VFD 2.2 kW | Servo 750 W |
|---|---|---|
| ≤ 300 V (200 V class) | FR-D720-2.2K | MR-JE-70A |
| > 300 V (400 V class) | FR-D740-2.2K | MR-J4-100A4 |

The 400 V MR-J4 range starts at 600 W and has no 750 W frame, so a 750 W axis
takes the next frame up (1 kW). Sizing up to the nearest available frame is
normal practice; the engine emits a `SERVO_FRAME` info warning so the
substitution is never silent.

---

## 5. Thermal

### Heat load

Only heat released **inside** the enclosure counts:

- VFD loss = `P_shaft × (1 − 0.97)`
- Servo loss = `P_shaft × (1 − 0.95)`
- PSU conversion loss = `P_24V,total × (1/0.90 − 1)` — on the whole throughput,
  including power headed out to the field
- Internal 24 V gear = 100% of its consumption
- Switchgear I²R: contactor 4 W, overload 3 W, MCCB 2.5 W/pole, MCB 1.2 W/pole

Field-device power is excluded and reported separately.

### Temperature rise

Practical form of **IEC 60890**. The effective cooling surface is the sum of the
faces, each weighted by exposure:

| Face | Factor `b` |
|---|---|
| Top | 1.4 |
| Front | 0.9 |
| Sides (×2) | 0.9 |
| Back (against a wall) | 0.5 |
| Bottom | 0.5 wall-mounted, 0 free-standing |

`Ae = Σ(area × b)`, then the steady-state balance including forced air:

```
P = (k · Ae) · ΔT + (V̇ / 3.1) · ΔT
ΔT = P / (k · Ae + V̇ / 3.1)
```

`k = 5.5 W/(m²·K)` for painted sheet steel under natural convection. `V̇ = 0`
gives the natural case, which is why one formula covers both. Design ceiling
inside the panel is 40 °C.

This replaces the prototype's `temp = 30 + heat/40`, whose constant divisor made
cabinet temperature **independent of cabinet size** — a 1200 mm enclosure ran as
hot as a 500 mm one, inverting the point of the module. Ambient was hardcoded at
30 °C; it is now an input.

### Airflow

```
V̇_ideal    = 3.1 × (P / ΔT_allowed − k · Ae)      m³/h
V̇_required = V̇_ideal × 1.25                       clogged filters, fan ageing
fans        = ceil(V̇_required / 100)               100 m³/h per fan WITH filter
CFM         = m³/h × 0.588
```

The 150 mm filter fan is rated ~180 m³/h free-blowing; 100 m³/h is the realistic
figure with a filter fitted. Above 4 fans the engine stops recommending fans and
calls for a cooling unit. If `ambient ≥ 40 °C` it goes straight to a cooling unit,
because forced air cannot pull the inside below ambient — a check the prototype
had no way to express.

Fan quantity now drives the layout **and** the BOM. The prototype printed "Dual
exhaust fans" above 250 W while unconditionally placing and purchasing one.

---

## 6. Enclosure sizing

Sizes are written **height first**, the way enclosure catalogues write them: a
400×300 panel is 400 tall by 300 wide. Every panel is therefore **portrait**,
which is the convention for wall-mount industrial enclosures.

Two modes, chosen in the designer's **Panel size (Tinggi × Lebar)** dropdown:

**Auto** (`cabH = 0`) — width is chosen, height is derived from the packed layout
and rounded up to the next standard size. Above 2000 mm it rounds to 100 mm with
a `HEIGHT_NONSTD` warning. If the derived height would come out *less* than the
width, it is raised to the next standard height at or above the width, so
automatic sizing never returns a landscape panel either (`portraitEnforced`).

**Catalogue size** — one of 400×300, 500×400, 600×400, 800×600, 1000×800,
1200×800 mm (H × W). The chosen height is used **exactly as given**, never silently
adjusted. If the packed backplate needs more height than the chosen panel, the
engine raises a `PANEL_TOO_SMALL` **error** stating the required figure — the
size is respected, and you are told it does not work. Same for the front cover
via `DOOR_TOO_SMALL`.

Note that a narrower panel usually needs *more* height, because rails wrap into
more rows: the same small machine needs 850 mm at 400 mm wide but only 504 mm at
800 mm wide.

- **Width** — from the chosen size, or user input in Auto mode.
- **Height** — see above.
- **Depth** — `deepest component + 80 mm` wiring clearance, rounded up to
  200/250/300/400 mm. The prototype hardcoded the string `× 300 mm`; depth was
  never calculated, and `COMPONENT_DB` had no depth field at all.
- **Mounting** — free-standing above 800 mm, which also changes `Ae`.

Rows **wrap** when a rail runs out of width, so a crowded design grows the
cabinet. The prototype set an `overflow` flag and then drew the components past
the enclosure wall anyway.

Fans get a reserved right-hand column. They are door- or side-mounted in reality
(`mount: 'door'`), but keeping the column clear guarantees the airflow path and
wiring space — the prototype placed a 150 mm filter fan on the backplate,
overlapping the rail-1 band.

---

## 7. Terminals and wiring

```
power terminals   = 3 incoming + 1 N + (VFD + servo + DOL) × 3 + motors
control terminals = DI + DO + (AI + AO) × 2
spares            = 15% of the above, installed
```

Wire colours follow **IEC 60204-1 §13.2**: power black · neutral light blue ·
AC control red · DC control dark blue · externally-supplied interlock orange ·
PE green-yellow. An invariant test asserts colour and size annotation always
agree (every `G/Y` wire is green-yellow and vice versa).

The wiring generator was missing whole circuit classes, all now present:
contactor coil circuits (PLC output → A1, A2 → safety contact), overload trip
feedback, per-motor and per-drive PE, door and backplate bonding, safety relay
outputs actually landing on drive STO inputs and the contactor return path, and
encoder cables. Field I/O is generated in full — the prototype capped the list at
`min(di, 32)`.

**Not modelled:** cable cross-sections are still nominal annotations, not sized.
Proper sizing needs current, length, installation method, grouping and
temperature per IEC 60364-5-52, plus a voltage-drop check. That is the next
step; **do not treat the size column as a calculated result.**

---

## 8. Layout geometry

`gap 15` between components · `pad 20` backplate margin · `gapV 12` between rails
· `ductH 45` · `tstripH 40` (mm). Tunable in the Layout Generator view.

### Clearance termal drive

Rail yang berisi drive memakai `driveClearance` (100 mm) di atas dan di bawah,
bukan `gapV` 12 mm seperti rail biasa — angka itu dari manual FR-D700 dan MR-J4,
yang meminta ruang napas untuk heatsink vertikal. Konsekuensinya jujur: panel
ber-drive jadi lebih tinggi (mesin acuan 843 → 1009 mm, kabinet 1000 → 1200 mm).

Layout otomatis selalu menjaga jarak ini. Penempatan manual bisa memindahkan
drive ke rail biasa, dan itu dilaporkan lewat `DRIVE_CLEARANCE`.

**Masih belum dimodelkan:** clearance samping antar drive, dan derating ketika
drive dipasang berdampingan rapat.

### Drive dibaut ke backplate, bukan diklip ke DIN rail

VFD dan servo amplifier punya `mount: 'plate'`. Di panel sungguhan badan drive
dibaut langsung ke plat belakang lewat lubang di heatsink-nya — tidak ada klip
DIN di belakangnya, dan massanya memang tidak pantas digantung di rail.

Baris yang **seluruh** isinya `mount: 'plate'` karena itu:

- tidak menggambar elemen rail (layar maupun cetak),
- dilabeli `BACKPLATE · DRIVES`, bukan `DIN RAIL 3 · DRIVES`,
- tidak ikut menambah `railLengthMm`, sehingga jumlah DIN rail di BOM turun
  (mesin acuan: 4 baris → 3 rail, 3040 → 2280 mm),
- memunculkan baris `FASTENER-M6` di BOM sebanyak 4 titik per komponen.

Baris campuran tetap berail — satu komponen ber-klip DIN di baris itu sudah
cukup untuk membutuhkan railnya.

`railFreeMm` sekarang hanya menghitung sisa ruang di rail yang benar-benar ada,
jadi angka "spare" tidak lagi ikut menghitung lebar yang dipakai drive.

---

## 9. Front cover (door) layout

A second view alongside the backplate, generated from the same config. Devices
are derived, not guessed at random:

| Device | Quantity | Basis |
|---|---|---|
| Emergency stop | 1 | IEC 60204-1 §10.7 — always present |
| Disconnect handle | 1 | door operator for the incoming MCCB |
| HMI | `cfg.hmi` | as configured |
| Selector AUTO/OFF/MAN | 1 | mode selection |
| START / STOP / RESET | 1 each | RESET drives the safety-relay reset input |
| Pilot lamp POWER (white) | 1 | supply healthy |
| Pilot lamp RUN (green) | `1 + DOL starters` | system run + hard-wired per starter |
| Pilot lamp FAULT (red) | 1 | from the safety relay and overload contacts |

Those are the devices the generator places by itself. The library holds the
**full front-cover catalogue** (35 devices) — other pushbutton colours,
illuminated pushbuttons, spring-return mushrooms, key-release E-stops,
2-position and key selectors, amber/blue lamps, potentiometer, buzzer, beacon,
4"/7"/10" HMIs, analogue ammeter and voltmeter, power/energy meter, hour meter,
temperature controller, door lock, inspection window, service socket, and RJ45 /
USB service couplers. Add any of them from **Components library → + Panel →
Front cover**; they are placed in an `ADDED FROM LIBRARY` zone, get stable ids so
they can be dragged, and reach the BOM and the 24 V budget like anything else.

Where I am not confident of a vendor code the part number is a **descriptor**
flagged `generic: true` (shown as ◇ and carried through to the BOM), with vendor
"to be specified" — 12 of the 35. A fabricated order number would look
authoritative and be wrong.

Geometry: Ø22 mm devices have a 29 mm bezel laid out on a 50 mm pitch
(`gap 21`); rows are 26 mm apart; a 60 mm margin on every edge keeps holes clear
of the gasket and return flange. The **E-stop gets a reserved block top-right**
that nothing else may enter — a test asserts no overlap — because the standard
wants it unobstructed. Rows wrap on width like the DIN rails.

Door devices reach the BOM flagged `door: true`, get a legend-plate line, and are
wired (selector, start, stop, reset, lamps, disconnect aux). Pilot lamps add
0.5 W each to the internal 24 V load; HMI power stays on its existing budget line
so it is never counted twice.

### Reference designations

Every placed device — front cover and backplate — gets a stable `id`
(`type#ordinal`, e.g. `estop#1`) and a `tag` following IEC 81346 prefixes:
Q switching/protection · F fuse-overload · G supply · K relay/contactor ·
A assembly (CPU, module) · S control switch · H indicator · T converter ·
E cooling. Door devices use **fixed** numbers so START is always S3 on every
drawing: Q1 disconnect, S1 E-stop, S2 selector, S3 START, S4 STOP, S5 RESET,
H1 POWER, H2 RUN, H3 FAULT, HMI1…n. The drawing, the coordinate schedule and the
BOM therefore all say the same thing.

### Manual positioning

Front-cover devices can be dragged. A moved device is stored in
`cfg.doorPos[id] = {x, y}`, snapped to 5 mm and clamped inside the door. Only
devices you actually moved are pinned (`door.manual`); everything else keeps
flowing from the generator, so adding an HMI still rearranges the rest. Because
positions are keyed on the stable id, a position is remembered even if the device
temporarily disappears from the configuration and comes back.

The reported extent is measured from where devices **actually** are, so a device
dragged off the door is caught. Two distinct errors: `DOOR_DEVICE_OUTSIDE` when a
*manually placed* device is outside (drag it back or reset), and `DOOR_TOO_SMALL`
when the *generator* could not fit them (choose a larger panel).

**Not modelled:** hole diameters as a drilling table (positions and bezel sizes
are there, cutout diameters are not), door interlocks, ergonomic height checks,
and collision detection between manually placed devices — you can overlap two
devices if you drag them on top of each other.

## 9b. Side panels — where the cooling actually lives

Exhaust fans never belonged on the backplate. The prototype drew them there and
reserved a 150 mm column on rail 1 to fake it; the review flagged that as wrong
because a filter fan is cut into the enclosure skin, not bolted to the mounting
plate. Cooling now has two dedicated views.

**Airflow crosses the enclosure.** Intake with filter sits **low on the left**,
exhaust fans sit **high on the right**, so air enters at the bottom-left, sweeps
past the drives (the biggest heat source, on rail 3) and leaves at the top-right.
One intake per exhaust — a fan with no inlet path just stalls against its own
back pressure.

Both views are drawn **from outside**, so the drawing width is the enclosure
**depth** (D), not its width. A 40 mm margin clears the folded edge where you
cannot cut. Devices stack downward from the top on the right and upward from the
bottom on the left, 20 mm apart.

Tags follow the same scheme as everywhere else: **E1, E2…** for exhaust fans,
**V1, V2…** for intake louvres. They match the drawing, the wiring list and the
BOM.

Consequences of moving the fan off the plate:

- Rail 1 got its full width back — 150 mm plus a gap that used to be reserved.
- The layout → size → thermal calculation is now a single pass. It used to
  iterate up to four times because fan count changed the reserved column, which
  changed the height, which changed the temperature, which changed the fan count.
- The BOM counts fans and filters once, from the side layout. The separate
  hand-written outlet-filter line is gone, so they can no longer disagree.

Checks: `SIDE_TOO_SHALLOW` when a device is wider than the panel depth allows
(quoting the real width, not a hardcoded 150 mm — reachable if you edit the fan
dimensions in the library), `SIDE_DEVICE_OUTSIDE` when a manually dragged device
leaves the panel outline, `SIDE_TOO_SMALL` when the stack is taller than the
enclosure.

Manual placement works like the front cover: drag with 5 mm snap, and a device
may be dragged **across** sides. Library components can be sent to either side
from **+ Panel → Left/Right side** — useful for inspection windows, extra
louvres, or a second fan bank.

**Not modelled:** cut-out dimensions (positions are given, hole sizes are not),
filter pressure drop, and IP degradation from adding vents — a louvred panel is
not IP55 any more, and the engine still reports IP55 from the enclosure line.

## 10. Panels without a PLC

Selecting **No PLC** treats the panel as relay-logic or pure motor-starter gear:
no CPU, no I/O rack, no analog modules, and no Ethernet switch unless an HMI
needs one. Contactors are commanded from the door pushbuttons through a latching
auxiliary contact instead of a PLC output, and overload trip contacts drive the
fault lamp and drop the coil directly. The 24 V budget loses the CPU and module
load accordingly.

Configured I/O counts are **kept, not zeroed** — selecting a PLC again restores
the rack exactly. While no CPU is selected the engine raises `IO_WITHOUT_PLC`
(and `HMI_WITHOUT_PLC` if an HMI is configured with nothing to talk to), and the
form disables those fields so no new meaningless values can be entered. A test
asserts no wiring row references a PLC that is not in the panel.

## 11. Component library overrides

The built-in database is estimate-grade (`dimsVerified: false`). The Components
library view lets you correct it, and corrections are **design inputs**, not
cosmetics — they flow into layout, enclosure sizing, the 24 V budget and the BOM:

```js
compute(cfg, { components: { plc: { w: 160, h: 95, pn: 'FX5U-64MT/ES' } } })
```

- Edits to a built-in component are stored as a **minimal diff** against the
  default, so a component still benefits if the built-in value is later improved.
- Setting a dimension flips nothing automatically — tick *dimensions verified*
  yourself once you have checked the datasheet. That badge is the only signal
  separating a confirmed figure from an estimate.
- Overrides are applied **last**, after selection tables. For the six
  selection-driven components (`psu`, `mccb`, `vfd`, `servo`, `contactor`,
  `overload`) a dimension override therefore **pins** the footprint for every
  variant, and the engine raises a `DIMS_PINNED` info warning saying so. Clear
  the override to restore automatic sizing.
- New components inherit `BLANK_COMPONENT`. They only enter a design when added
  to a project's `extras`, which records `{type, qty, rail}`. Placed components
  contribute their `powerW` to the internal 24 V load (and therefore to heat),
  and appear in the BOM like any other part.
- An `extras` entry pointing at a component that no longer exists produces an
  `UNKNOWN_COMPONENT` error and is skipped — the design still computes.

Images uploaded in the library are downscaled to 360 px and stored as data URIs
in the database, so they travel with the project rather than depending on files
in `assets/components/`. They are presentation only; nothing reads pixels.

## Deliberate omissions

Things the tool could easily fabricate and deliberately does not:

- **Stock status and lead time.** There is no supplier feed. The prototype
  assigned "In stock / Lead 2 wk / RFQ sent" by row index (`statuses[i % 5]`) —
  fiction in front of purchasing. Each BOM line instead carries `source:
  'calculated' | 'estimated'`.
- **Prices.** `unitPrice` and `subtotal` exist as `null` so the schema is ready
  for the cost estimator; nothing invents a number.
- **Vendor order numbers for commodities.** Enclosure, backplate, gland plate,
  DIN rail, duct, PE bar, glands and backplate fasteners are generic descriptors
  flagged `generic: true` (shown as ◇). A fabricated Rittal order number would
  look authoritative and be wrong. The `FASTENER-M6` line is additionally
  `estimated` — 4 titik per komponen adalah praktik lazim, bukan angka dari
  lembar data.
- **Wire lengths.** Flagged `estimated` with a 1.2 m per-wire allowance stated in
  the line note. Real lengths need routing, which is Phase 4.

## Test coverage

`npm test` — 125 assertions, no dependencies. Golden values pin the reference
machine; invariants hold across a 12-config matrix including an empty panel and
garbage input. The invariants are the ones that catch regressions: PSU headroom,
fan-count agreement across thermal/layout/BOM/wiring, every component inside the
backplate using resolved footprints, voltage-class match, no silent truncation,
monotonicity, heat excluding field devices, BOM completeness, wire-colour
consistency, determinism, and legacy-config migration.
