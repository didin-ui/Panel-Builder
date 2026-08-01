/* ═══════════════════════════════════════════════════════════════════════════
   Panel Builder Assistant — design engine
   ───────────────────────────────────────────────────────────────────────────
   Pure, DOM-free, dependency-free. Loadable three ways:
     browser (file:// or http)  <script src="engine.js">  → window.PanelEngine
     Node / tests               require('./engine.js')

   Every numeric constant lives in ASSUMPTIONS or a lookup table below and is
   documented in ENGINEERING.md. Nothing in this file reads the DOM, the clock,
   or the network, so compute(cfg) is deterministic and testable.

   ⚠ Part numbers and dimensions are engineering-grade estimates for sizing and
   layout. Verify against the current vendor datasheet before purchase — see
   `dimsVerified` on each component.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ══════════ ASSUMPTIONS ══════════
     Overridable per call: compute(cfg, {psuMaxUtil: 0.6}). Defaults are
     conservative small-panel values; see ENGINEERING.md for the rationale. */
  const ASSUMPTIONS = {
    /* Load ratings the count-based config implies (kW / W of shaft power) */
    vfdKw: 2.2,
    servoW: 750,
    dolKw: 1.5,

    /* Displacement power factor at the panel supply terminals */
    pf: { vfd: 0.95, servo: 0.90, dol: 0.82, psu: 0.95 },

    /* Efficiencies. vfdMotor/dolMotor are IE3-class small-motor values. */
    eff: { vfdDrive: 0.97, vfdMotor: 0.85, servoDrive: 0.95, servoMotor: 0.90,
           dolMotor: 0.80, psu: 0.90 },

    /* DOL locked-rotor current as a multiple of FLC (IEC design N ≈ 6–8×) */
    dolStartMultiple: 6.5,

    /* IEC 60204-1 §7.2.1 continuous-duty allowance for feeder sizing */
    breakerMargin: 1.25,

    /* PSU headroom. PRD asks for ~30% spare → size at ≤70% of rated output. */
    psuMaxUtil: 0.70,

    /* Thermal. k = practical heat-transfer coefficient for painted sheet steel
       under natural convection, W/(m²·K). Simplification of IEC 60890. */
    kEnclosure: 5.5,
    maxInternalC: 40,          /* design ceiling inside the panel */
    airConstant: 3.1,          /* m³/h per W per K — V̇ = 3.1·P/ΔT at ~40 °C */
    fanFlowM3h: 100,           /* effective flow of one 150 mm filter fan WITH
                                  filter fitted (free-air rating is ~180) */
    fanMargin: 1.25,           /* oversize airflow — filters clog, fans age */
    maxFans: 4,                /* beyond this, recommend a cooling unit */

    /* Switch-mode PSUs draw a large charging inrush; a C2 would nuisance-trip
       even though the steady current is well under 1 A. */
    minControlMcbA: 6,

    /* Internal dissipation of switchgear, W each (I²R + coil) */
    heatPerContactor: 4,
    heatPerOverload: 3,
    heatPerMccbPole: 2.5,
    heatPerMcbPole: 1.2,

    /* Fraction of the terminal count kept as installed spares */
    terminalSparePct: 0.15,

    /* FX5U extension bus limit (module count, not current budget) */
    maxExpansionModules: 16,

    /* Layout geometry, mm. Exposed because the Layout Generator view tunes it. */
    layout: {
      gap: 15,      /* horizontal clearance between components on a rail */
      pad: 20,      /* backplate margin */
      gapV: 12,     /* vertical clearance between rails and ducts */
      /* Drive (VFD/servo) membuang panas lewat heatsink vertikal dan butuh
         ruang napas di atas & bawah — manual Mitsubishi FR-D700 dan MR-J4
         meminta ~100 mm. Rail biasa cukup gapV; rail berisi drive dipaksa
         memakai angka ini. Dulu semua rail memakai 12 mm, sehingga rail drive
         yang lolos di layar tidak bisa dirakit. */
      driveClearance: 100,
      ductH: 45,    /* wire duct height */
      tstripH: 40,  /* terminal strip band height */
    },

    /* Front cover geometry, mm. The margin clears the door gasket and the
       return flange, where you cannot drill. */
    door: {
      margin: 60,
      gap: 21,      /* 29 mm bezel + 21 mm = 50 mm pitch for Ø22 devices */
      rowGap: 26,
    },
  };

  /* ══════════ STANDARD SIZES ══════════ */
  const STD_HEIGHTS = [500, 600, 700, 800, 1000, 1200, 1400, 1600, 1800, 2000];
  const STD_WIDTHS  = [400, 600, 800, 1000, 1200];
  const STD_DEPTHS  = [200, 250, 300, 400];
  /* Catalogue sizes the designer offers, written the way enclosure catalogues
     write them: HEIGHT first, then width — so 400×300 is 400 tall by 300 wide,
     a portrait panel. cabH = 0 keeps automatic sizing, where the height comes
     from the packed layout instead. */
  const STD_SIZES = [
    { h: 400,  w: 300 },
    { h: 500,  w: 400 },
    { h: 600,  w: 400 },
    { h: 800,  w: 600 },
    { h: 1000, w: 800 },
    { h: 1200, w: 800 },
  ];

  /* Wiring clearance in front of the deepest component, mm */
  const DEPTH_CLEARANCE = 80;

  /* ══════════ PROTECTION LADDERS ══════════
     Trip ratings are the IEC preferred series actually stocked in these frames. */
  const MCCB_FRAMES = [
    { frame: 32,  trips: [16, 20, 25, 32],   pn: 'NF32-SV',  w: 75,  h: 130, d: 68 },
    { frame: 63,  trips: [40, 50, 63],       pn: 'NF63-CV',  w: 75,  h: 130, d: 68 },
    { frame: 125, trips: [80, 100, 125],     pn: 'NF125-SV', w: 105, h: 165, d: 86 },
    { frame: 250, trips: [160, 200, 250],    pn: 'NF250-SV', w: 140, h: 257, d: 103 },
  ];
  const MCB_TRIPS = [2, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63];

  /* Schneider TeSys D — 24 VDC coil (BD suffix) so the whole control system
     runs on the one 24 V rail already present. AC-3 rating at 400 V. */
  const CONTACTORS = [
    { pn: 'LC1D09BD', ac3A: 9,  kw400: 4.0,  w: 45, h: 77,  d: 86 },
    { pn: 'LC1D12BD', ac3A: 12, kw400: 5.5,  w: 45, h: 77,  d: 86 },
    { pn: 'LC1D18BD', ac3A: 18, kw400: 7.5,  w: 45, h: 77,  d: 86 },
    { pn: 'LC1D25BD', ac3A: 25, kw400: 11.0, w: 45, h: 84,  d: 96 },
    { pn: 'LC1D32BD', ac3A: 32, kw400: 15.0, w: 45, h: 84,  d: 96 },
    { pn: 'LC1D38BD', ac3A: 38, kw400: 18.5, w: 45, h: 84,  d: 96 },
  ];
  /* Schneider LRD thermal overload — set range must bracket motor FLC */
  const OVERLOADS = [
    { pn: 'LRD05', min: 0.63, max: 1.0,  w: 45, h: 70, d: 68 },
    { pn: 'LRD06', min: 1.0,  max: 1.6,  w: 45, h: 70, d: 68 },
    { pn: 'LRD07', min: 1.6,  max: 2.5,  w: 45, h: 70, d: 68 },
    { pn: 'LRD08', min: 2.5,  max: 4.0,  w: 45, h: 70, d: 68 },
    { pn: 'LRD10', min: 4.0,  max: 6.0,  w: 45, h: 70, d: 68 },
    { pn: 'LRD12', min: 5.5,  max: 8.0,  w: 45, h: 70, d: 68 },
    { pn: 'LRD14', min: 7.0,  max: 10.0, w: 45, h: 70, d: 68 },
    { pn: 'LRD16', min: 9.0,  max: 13.0, w: 45, h: 70, d: 68 },
    { pn: 'LRD21', min: 12.0, max: 18.0, w: 45, h: 70, d: 68 },
    { pn: 'LRD22', min: 16.0, max: 24.0, w: 45, h: 70, d: 68 },
  ];
  /* Phoenix Contact QUINT4 — single-phase input, 24 VDC output */
  const PSU_LADDER = [
    { pn: 'QUINT4-PS/1AC/24DC/5',  a: 5,  w: 45,  h: 130, d: 125 },
    { pn: 'QUINT4-PS/1AC/24DC/10', a: 10, w: 60,  h: 130, d: 125 },
    { pn: 'QUINT4-PS/1AC/24DC/20', a: 20, w: 97,  h: 130, d: 125 },
    { pn: 'QUINT4-PS/1AC/24DC/40', a: 40, w: 130, h: 130, d: 145 },
  ];

  /* Drives by supply voltage class. Mitsubishi FR-D700: D720 = 200 V,
     D740 = 400 V. MR-JE is 200 V only; the 400 V equivalent is MR-J4 with the
     "4" suffix, whose smallest frame is 600 W, so a 750 W axis takes the next
     frame up (100A4 = 1 kW). Sizing up to the nearest available frame is
     normal practice — the amplifier is oversized, not mismatched. */
  /* ══════════ KATALOG DRIVE PER RATING ══════════
     Sebelumnya semua VFD dianggap 2,2 kW dan semua servo 750 W, jadi mesin
     dengan rating campur (fan 5,5 kW + dua pompa 1,5 kW) tidak bisa dinyatakan
     — dan arus, breaker, kabel, panas, serta FOOTPRINT-nya semua salah.
     Ukuran dikelompokkan per frame; seperti biasa dimsVerified:false. */
  const VFD_FRAMES = [
    { max: 1.5, w: 108, h: 128, d: 135 },
    { max: 3.7, w: 108, h: 128, d: 155 },
    { max: 7.5, w: 170, h: 260, d: 170 },
    { max: 15,  w: 220, h: 300, d: 195 },
  ];
  const SERVO_FRAMES = [
    { max: 1.0, w: 85,  h: 168, d: 195 },
    { max: 2.0, w: 105, h: 168, d: 195 },
    { max: 5.0, w: 130, h: 250, d: 200 },
  ];
  /* [kW, part number] per kelas tegangan. Ditulis eksplisit, bukan dihitung:
     penomoran MR-JE tidak seragam — 750 W adalah MR-JE-70A, bukan -75A. */
  const VFD_LADDER = {
    200: [[0.4, 'FR-D720-0.4K'], [0.75, 'FR-D720-0.75K'], [1.5, 'FR-D720-1.5K'],
          [2.2, 'FR-D720-2.2K'], [3.7, 'FR-D720-3.7K']],
    400: [[0.4, 'FR-D740-0.4K'], [0.75, 'FR-D740-0.75K'], [1.5, 'FR-D740-1.5K'],
          [2.2, 'FR-D740-2.2K'], [3.7, 'FR-D740-3.7K'], [5.5, 'FR-D740-5.5K'],
          [7.5, 'FR-D740-7.5K'], [11, 'FR-F840-11K'], [15, 'FR-F840-15K']],
  };
  const SERVO_LADDER = {
    200: [[0.1, 'MR-JE-10A'], [0.2, 'MR-JE-20A'], [0.4, 'MR-JE-40A'],
          [0.75, 'MR-JE-70A'], [1.0, 'MR-JE-100A'], [2.0, 'MR-JE-200A'],
          [3.0, 'MR-JE-300A']],
    400: [[0.6, 'MR-J4-60A4'], [1.0, 'MR-J4-100A4'], [2.0, 'MR-J4-200A4'],
          [3.5, 'MR-J4-350A4'], [5.0, 'MR-J4-500A4']],
  };
  const kwTag = (kw) => String(kw).replace('.', 'k') + (String(kw).indexOf('.') < 0 ? 'k' : '');

  /* Pilih frame terkecil yang sanggup; kalau melebihi ladder, pakai yang terbesar
     dan laporkan. Menaikkan ke frame terdekat adalah praktik normal. */
  function pickDrive(kind, kW, cls) {
    const ladder = (kind === 'servo' ? SERVO_LADDER : VFD_LADDER)[cls] ||
                   (kind === 'servo' ? SERVO_LADDER : VFD_LADDER)[400];
    const frames = kind === 'servo' ? SERVO_FRAMES : VFD_FRAMES;
    const hit = ladder.find((x) => x[0] >= kW - 1e-9);
    const over = !hit;
    const [use, pn] = hit || ladder[ladder.length - 1];
    const f = frames.find((x) => use <= x.max) || frames[frames.length - 1];
    return { pn, ratedKw: use, over, w: f.w, h: f.h, d: f.d,
             key: kind + '_' + cls + '_' + kwTag(use) };
  }

  const DRIVES = {
    vfd: {
      200: { pn: 'FR-D720-2.2K', w: 108, h: 128, d: 155 },
      400: { pn: 'FR-D740-2.2K', w: 108, h: 128, d: 145 },
    },
    servo: {
      200: { pn: 'MR-JE-70A',  w: 70, h: 168, d: 195, ratedW: 750 },
      400: { pn: 'MR-J4-100A4', w: 85, h: 168, d: 195, ratedW: 1000 },
    },
  };

  /* ══════════ COMPONENT DATABASE ══════════
     w/h = front-view footprint (mm), d = depth off the backplate (mm).
     powerW = 24 V consumption for control gear, 0 where not applicable.
     mount: 'rail' | 'plate' | 'door'.
     dimsVerified: false ⇒ dimension is an estimate, confirm with datasheet. */
  const COMPONENT_DB = {
    mccb:      { asset:'mccb-3p-40a.png',      w:75,   h:130, d:68,  cat:'Protection', label:'Main Breaker',    color:'#B3372E', bg:'#FAE3E1', pn:'NF32-SV-3P-32A',        desc:'Main breaker MCCB 3P',                 vendor:'Mitsubishi Electric', mount:'rail', powerW:0,  dimsVerified:false },
    spd:       { asset:'spd-3p-385v.png',      w:72,   h:90,  d:66,  cat:'Protection', label:'SPD',             color:'#C08415', bg:'#FBEED3', pn:'SPD-3P-385V-T2',        desc:'Surge protection device 3P+N T2',      vendor:'CITEL',               mount:'rail', powerW:0,  dimsVerified:false },
    /* `psu` = slot yang diisi otomatis oleh selectPsu; part number, ukuran dan
       kapasitasnya menyusul hasil pemilihan. `psuA` menyatakan kapasitas keluaran
       — semua komponen ber-psuA dihitung sebagai sumber 24 V. */
    psu:       { asset:'psu-24vdc.png',        w:97,   h:130, d:125, cat:'Power',      label:'Power Supply',    color:'#2478CE', bg:'#E3EEF9', pn:'QUINT4-PS/1AC/24DC/20', desc:'Power supply 24 VDC',                  vendor:'Phoenix Contact',     mount:'rail', powerW:0,  dimsVerified:false, psuA:20 },
    /* Katalog PSU untuk dipilih sendiri dari library (+ Panel). Menambah salah
       satu dari ini mematikan pemilihan otomatis — lihat ENGINEERING.md §2. */
    psu_5a:    { asset:'psu-24vdc-5a.png',     w:45,   h:130, d:125, cat:'Power',      label:'Power Supply',    color:'#2478CE', bg:'#E3EEF9', pn:'QUINT4-PS/1AC/24DC/5',  desc:'Power supply 24 VDC 5 A',              vendor:'Phoenix Contact',     mount:'rail', powerW:0,  dimsVerified:false, psuA:5 },
    psu_10a:   { asset:'psu-24vdc-10a.png',    w:60,   h:130, d:125, cat:'Power',      label:'',                color:'#2478CE', bg:'#E3EEF9', pn:'QUINT4-PS/1AC/24DC/10', desc:'Power supply 24 VDC 10 A',             vendor:'Phoenix Contact',     mount:'rail', powerW:0,  dimsVerified:false, psuA:10 },
    psu_20a:   { asset:'psu-24vdc-20a.png',    w:97,   h:130, d:125, cat:'Power',      label:'',                color:'#2478CE', bg:'#E3EEF9', pn:'QUINT4-PS/1AC/24DC/20', desc:'Power supply 24 VDC 20 A',             vendor:'Phoenix Contact',     mount:'rail', powerW:0,  dimsVerified:false, psuA:20 },
    psu_40a:   { asset:'psu-24vdc-40a.png',    w:130,  h:130, d:145, cat:'Power',      label:'',                color:'#2478CE', bg:'#E3EEF9', pn:'QUINT4-PS/1AC/24DC/40', desc:'Power supply 24 VDC 40 A',             vendor:'Phoenix Contact',     mount:'rail', powerW:0,  dimsVerified:false, psuA:40 },
    contactor: { asset:'contactor.png',        w:45,   h:77,  d:86,  cat:'Switching',  label:'Contactor',       color:'#6B7885', bg:'#EEF1F4', pn:'LC1D09BD',              desc:'Contactor AC-3, coil 24 VDC',          vendor:'Schneider Electric',  mount:'rail', powerW:2,  dimsVerified:false },
    overload:  { asset:'thermal-overload.png', w:45,   h:70,  d:68,  cat:'Protection', label:'',                color:'#6B7885', bg:'#EEF1F4', pn:'LRD10',                 desc:'Thermal overload relay',               vendor:'Schneider Electric',  mount:'rail', powerW:0,  dimsVerified:false },
    safety:    { asset:'safety-relay.png',     w:22.5, h:99,  d:115, cat:'Safety',     label:'Safety Relay',    color:'#0F7A6C', bg:'#DDF1EE', pn:'PSR-SCP-24DC/ESD/4X1',  desc:'Safety relay dual channel 4 NO',       vendor:'Phoenix Contact',     mount:'rail', powerW:4,  dimsVerified:false },
    irelay:    { asset:'interface-relay.png',  w:15,   h:80,  d:90,  cat:'Switching',  label:'Relays',          color:'#6B7885', bg:'#EEF1F4', pn:'RIF-0-RPT-24DC',        desc:'Interface relay slim 24 VDC + socket', vendor:'Phoenix Contact',     mount:'rail', powerW:0.5,dimsVerified:false },
    /* ── CPU. Semua entri ber-isPlc:true muncul di dropdown PLC, termasuk yang
       kamu tambahkan sendiri dari Components library. `builtinDi/Do` menentukan
       berapa modul ekspansi yang perlu dibeli, `maxExp` batas bus-nya, dan
       `exp*` menunjuk komponen mana yang dipakai untuk ekspansi. Mengganti CPU
       benar-benar mengubah layout, BOM, beban 24 V, dan jumlah modul. */
    plc:       { asset:'plc-fx5u-32m.png',     w:150,  h:90,  d:83,  cat:'Control',    label:'PLC',             color:'#2478CE', bg:'#E3EEF9', pn:'FX5U-32MT/ES',          desc:'PLC CPU 16 DI / 16 DO, Ethernet',      vendor:'Mitsubishi Electric', mount:'rail', powerW:30, dimsVerified:false,
                 isPlc:true, plcName:'Mitsubishi FX5U-32M', builtinDi:16, builtinDo:16, maxExp:16,
                 expDi:'di16', expDo:'do16', expAi:'ad4', expAo:'da4' },
    plc_fx5u64:{ asset:'plc-fx5u-64m.png',     w:220,  h:90,  d:83,  cat:'Control',    label:'PLC',             color:'#2478CE', bg:'#E3EEF9', pn:'FX5U-64MT/ES',          desc:'PLC CPU 32 DI / 32 DO, Ethernet',      vendor:'Mitsubishi Electric', mount:'rail', powerW:35, dimsVerified:false,
                 isPlc:true, plcName:'Mitsubishi FX5U-64M', builtinDi:32, builtinDo:32, maxExp:16,
                 expDi:'di16', expDo:'do16', expAi:'ad4', expAo:'da4' },
    plc_fx5u80:{ asset:'plc-fx5u-80m.png',     w:285,  h:90,  d:83,  cat:'Control',    label:'PLC',             color:'#2478CE', bg:'#E3EEF9', pn:'FX5U-80MT/ES',          desc:'PLC CPU 40 DI / 40 DO, Ethernet',      vendor:'Mitsubishi Electric', mount:'rail', powerW:40, dimsVerified:false,
                 isPlc:true, plcName:'Mitsubishi FX5U-80M', builtinDi:40, builtinDo:40, maxExp:16,
                 expDi:'di16', expDo:'do16', expAi:'ad4', expAo:'da4' },
    plc_fx5uj40:{asset:'plc-fx5uj-40m.png',    w:130,  h:90,  d:83,  cat:'Control',    label:'PLC',             color:'#2478CE', bg:'#E3EEF9', pn:'FX5UJ-40MT/ES',         desc:'PLC CPU 24 DI / 16 DO, Ethernet',      vendor:'Mitsubishi Electric', mount:'rail', powerW:25, dimsVerified:false,
                 isPlc:true, plcName:'Mitsubishi FX5UJ-40M', builtinDi:24, builtinDo:16, maxExp:8,
                 expDi:'di16', expDo:'do16', expAi:'ad4', expAo:'da4' },
    plc_fx5uj60:{asset:'plc-fx5uj-60m.png',    w:150,  h:90,  d:83,  cat:'Control',    label:'PLC',             color:'#2478CE', bg:'#E3EEF9', pn:'FX5UJ-60MT/ES',         desc:'PLC CPU 36 DI / 24 DO, Ethernet',      vendor:'Mitsubishi Electric', mount:'rail', powerW:28, dimsVerified:false,
                 isPlc:true, plcName:'Mitsubishi FX5UJ-60M', builtinDi:36, builtinDo:24, maxExp:8,
                 expDi:'di16', expDo:'do16', expAi:'ad4', expAo:'da4' },
    plc_s71212:{ asset:'plc-s7-1212c.png',     w:90,   h:100, d:75,  cat:'Control',    label:'PLC',             color:'#0F7A6C', bg:'#DDF1EE', pn:'6ES7212-1AE40-0XB0',    desc:'PLC CPU 1212C DC/DC/DC, 8 DI / 6 DO',  vendor:'Siemens',             mount:'rail', powerW:12, dimsVerified:false,
                 isPlc:true, plcName:'Siemens S7-1200 CPU 1212C', builtinDi:8, builtinDo:6, maxExp:8,
                 expDi:'exp_di16', expDo:'exp_do16', expAi:'exp_ai4', expAo:'exp_ao4' },
    plc_s71214:{ asset:'plc-s7-1214c.png',     w:110,  h:100, d:75,  cat:'Control',    label:'PLC',             color:'#0F7A6C', bg:'#DDF1EE', pn:'6ES7214-1AG40-0XB0',    desc:'PLC CPU 1214C DC/DC/DC, 14 DI / 10 DO',vendor:'Siemens',             mount:'rail', powerW:14, dimsVerified:false,
                 isPlc:true, plcName:'Siemens S7-1200 CPU 1214C', builtinDi:14, builtinDo:10, maxExp:8,
                 expDi:'exp_di16', expDo:'exp_do16', expAi:'exp_ai4', expAo:'exp_ao4' },
    plc_cp1e30:{ asset:'plc-cp1e-30.png',      w:130,  h:90,  d:85,  cat:'Control',    label:'PLC',             color:'#2478CE', bg:'#E3EEF9', pn:'CP1E-N30DR-A',          desc:'PLC CP1E 18 DI / 12 DO relay',         vendor:'Omron',               mount:'rail', powerW:20, dimsVerified:false,
                 isPlc:true, plcName:'Omron CP1E-N30DR', builtinDi:18, builtinDo:12, maxExp:3,
                 expDi:'exp_di16', expDo:'exp_do16', expAi:'exp_ai4', expAo:'exp_ao4' },
    plc_dvp32: { asset:'plc-dvp32es.png',      w:150,  h:90,  d:60,  cat:'Control',    label:'PLC',             color:'#5B4BB5', bg:'#EAE7F8', pn:'DVP32ES200R',           desc:'PLC DVP-ES2 16 DI / 16 DO relay',      vendor:'Delta',               mount:'rail', powerW:18, dimsVerified:false,
                 isPlc:true, plcName:'Delta DVP32ES2', builtinDi:16, builtinDo:16, maxExp:8,
                 expDi:'exp_di16', expDo:'exp_do16', expAi:'exp_ai4', expAo:'exp_ao4' },
    plc_m221:  { asset:'plc-m221.png',         w:110,  h:90,  d:70,  cat:'Control',    label:'PLC',             color:'#1E7B4D', bg:'#DFF2E7', pn:'TM221CE24R',            desc:'PLC Modicon M221 14 DI / 10 DO relay', vendor:'Schneider Electric',  mount:'rail', powerW:16, dimsVerified:false,
                 isPlc:true, plcName:'Schneider M221 CE24R', builtinDi:14, builtinDo:10, maxExp:7,
                 expDi:'exp_di16', expDo:'exp_do16', expAi:'exp_ai4', expAo:'exp_ao4' },
    plc_micro850:{asset:'plc-micro850.png',    w:130,  h:90,  d:80,  cat:'Control',    label:'PLC',             color:'#B3372E', bg:'#FAE3E1', pn:'2080-LC50-24QWB',       desc:'PLC Micro850 14 DI / 10 DO relay',     vendor:'Rockwell Automation', mount:'rail', powerW:18, dimsVerified:false,
                 isPlc:true, plcName:'Allen-Bradley Micro850', builtinDi:14, builtinDo:10, maxExp:4,
                 expDi:'exp_di16', expDo:'exp_do16', expAi:'exp_ai4', expAo:'exp_ao4' },

    /* Ekspansi generik untuk CPU non-Mitsubishi: ukuran & part number harus
       diganti sesuai vendor, jadi ditandai generic. */
    exp_di16:  { asset:'exp-module-16di.png',                     w:45,   h:100, d:75,  cat:'Control',    label:'I/O Modules',     color:'#42505C', bg:'#EEF1F4', pn:'EXP-DI16',              desc:'Expansion module 16 DI (pilih sesuai vendor)', vendor:'to be specified', mount:'rail', powerW:5, dimsVerified:false, generic:true },
    exp_do16:  { asset:'exp-module-16do.png',                     w:45,   h:100, d:75,  cat:'Control',    label:'',                color:'#42505C', bg:'#EEF1F4', pn:'EXP-DO16',              desc:'Expansion module 16 DO (pilih sesuai vendor)', vendor:'to be specified', mount:'rail', powerW:5, dimsVerified:false, generic:true },
    exp_ai4:   { asset:'exp-module-4ai.png',   w:45,   h:100, d:75,  cat:'Control',    label:'',                color:'#42505C', bg:'#EEF1F4', pn:'EXP-AI4',               desc:'Analog input module 4 ch (pilih sesuai vendor)',vendor:'to be specified', mount:'rail', powerW:5, dimsVerified:false, generic:true },
    exp_ao4:   { asset:'exp-module-4ao.png',   w:45,   h:100, d:75,  cat:'Control',    label:'',                color:'#42505C', bg:'#EEF1F4', pn:'EXP-AO4',               desc:'Analog output module 4 ch (pilih sesuai vendor)',vendor:'to be specified', mount:'rail', powerW:5, dimsVerified:false, generic:true },
    di16:      { asset:'io-module-16di.png',   w:40,   h:90,  d:83,  cat:'Control',    label:'I/O Modules',     color:'#2478CE', bg:'#E3EEF9', pn:'FX5-16EX/ES',           desc:'Expansion module 16 DI',               vendor:'Mitsubishi Electric', mount:'rail', powerW:5,  dimsVerified:false },
    do16:      { asset:'io-module-16do.png',   w:40,   h:90,  d:83,  cat:'Control',    label:'',                color:'#2478CE', bg:'#E3EEF9', pn:'FX5-16EYT/ES',          desc:'Expansion module 16 DO transistor',    vendor:'Mitsubishi Electric', mount:'rail', powerW:5,  dimsVerified:false },
    ad4:       { asset:'analog-module-4ad.png',w:40,   h:90,  d:83,  cat:'Control',    label:'',                color:'#2478CE', bg:'#E3EEF9', pn:'FX5-4AD',               desc:'Analog input module 4 ch',             vendor:'Mitsubishi Electric', mount:'rail', powerW:5,  dimsVerified:false },
    da4:       { asset:'analog-module-4da.png',w:40,   h:90,  d:83,  cat:'Control',    label:'',                color:'#2478CE', bg:'#E3EEF9', pn:'FX5-4DA',               desc:'Analog output module 4 ch',            vendor:'Mitsubishi Electric', mount:'rail', powerW:5,  dimsVerified:false },
    eth:       { asset:'ethernet-switch-8p.png',w:52,  h:135, d:105, cat:'Network',    label:'Ethernet Switch', color:'#0F7A6C', bg:'#DDF1EE', pn:'FL-SWITCH-1008N',       desc:'Ethernet switch industrial 8 port',    vendor:'Phoenix Contact',     mount:'rail', powerW:8,  dimsVerified:false },
    mcb3:      { asset:'mcb-3p.png',           w:54,   h:90,  d:70,  cat:'Protection', label:'MCB',             color:'#6B7885', bg:'#EEF1F4', pn:'MCB-3P-C16',            desc:'MCB 3P curve C, drives feeder',        vendor:'Schneider Electric',  mount:'rail', powerW:0,  dimsVerified:false },
    mcb1:      { asset:'mcb-1p.png',           w:18,   h:90,  d:70,  cat:'Protection', label:'',                color:'#6B7885', bg:'#EEF1F4', pn:'MCB-1P-C6',             desc:'MCB 1P curve C, control',              vendor:'Schneider Electric',  mount:'rail', powerW:0,  dimsVerified:false },
    vfd:       { asset:'vfd.png',              w:108,  h:128, d:145, cat:'Drives',     label:'VFD Drives',      color:'#5B4BB5', bg:'#EAE7F8', pn:'FR-D740-2.2K',          desc:'Inverter VFD',                         vendor:'Mitsubishi Electric', mount:'plate', powerW:0, dimsVerified:false },
    servo:     { asset:'servo.png',            w:85,   h:168, d:195, cat:'Drives',     label:'Servo Drives',    color:'#B03A6C', bg:'#F8E4ED', pn:'MR-J4-100A4',           desc:'Servo amplifier',                      vendor:'Mitsubishi Electric', mount:'plate', powerW:0, dimsVerified:false },
    /* Pendinginan hidup di panel SISI: exhaust fan tinggi di sisi kanan,
       intake berfilter rendah di sisi kiri — udara masuk bawah-kiri, menyapu
       drive, keluar atas-kanan. */
    fan:       { asset:'cooling-fan-150.png',  w:150,  h:150, d:100, cat:'Cooling',    label:'Exhaust Fan',     color:'#6B7885', bg:'#EEF1F4', pn:'SK-3239-100',           desc:'Exhaust filter fan 150 mm (side mounted)', vendor:'Rittal',          mount:'side', powerW:0,  dimsVerified:false },
    filter_out:{ asset:'outlet-filter-150.png',w:150,  h:150, d:30,  cat:'Cooling',    label:'Intake Filter',   color:'#6B7885', bg:'#EEF1F4', pn:'SK-3239-200',           desc:'Intake louvre + filter 150 mm (side mounted)', vendor:'Rittal',      mount:'side', powerW:0,  dimsVerified:false },

    /* ── Terminal blocks ─────────────────────────────────────────────────
       Dipasang di RAIL 4 · TERMINAL BLOCKS. `w` adalah lebar per pole
       (pitch di rail), jadi 20 buah UT 2,5 memakai 20 × 5,2 mm. Sebelumnya
       terminal hanya dihitung sebagai angka di BOM tanpa pernah masuk layout. */
    tb_2_5:    { asset:'tb-ut2.5.png',   w:5.2, h:47, d:47, cat:'Terminals', label:'Terminals', color:'#42505C', bg:'#EEF1F4', pn:'UT 2,5',        desc:'Terminal feed-through 2,5 mm² (24 A)',       vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_4:      { asset:'tb-ut4.png',     w:6.2, h:47, d:47, cat:'Terminals', label:'',          color:'#42505C', bg:'#EEF1F4', pn:'UT 4',          desc:'Terminal feed-through 4 mm² (32 A)',         vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_6:      { asset:'tb-ut6.png',     w:8.2, h:52, d:52, cat:'Terminals', label:'',          color:'#42505C', bg:'#EEF1F4', pn:'UT 6',          desc:'Terminal feed-through 6 mm² (41 A)',         vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_10:     { asset:'tb-ut10.png',    w:10.2,h:57, d:57, cat:'Terminals', label:'',          color:'#42505C', bg:'#EEF1F4', pn:'UT 10',         desc:'Terminal feed-through 10 mm² (57 A)',        vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_16:     { asset:'tb-ut16.png',    w:12.2,h:62, d:62, cat:'Terminals', label:'',          color:'#42505C', bg:'#EEF1F4', pn:'UT 16',         desc:'Terminal feed-through 16 mm² (76 A)',        vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_pe:     { asset:'tb-pe.png',      w:6.2, h:47, d:47, cat:'Terminals', label:'PE',        color:'#8FBF3F', bg:'#EFF6E2', pn:'UT 4-PE',       desc:'Terminal ground PE 4 mm², hijau-kuning',     vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_n:      { asset:'tb-n.png',       w:6.2, h:47, d:47, cat:'Terminals', label:'',          color:'#7FB6E0', bg:'#E8F2FA', pn:'UT 4-N',        desc:'Terminal netral 4 mm², biru muda',           vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_2lvl:   { asset:'tb-2level.png',  w:5.2, h:62, d:52, cat:'Terminals', label:'',          color:'#42505C', bg:'#EEF1F4', pn:'UTTB 2,5',      desc:'Terminal double-level 2,5 mm² (hemat rail)', vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_fuse:   { asset:'tb-fuse.png',    w:8.2, h:62, d:57, cat:'Terminals', label:'',          color:'#C08415', bg:'#FBEED3', pn:'UT 4-HESI',     desc:'Terminal berfuse 4 mm², 5×20 mm',            vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_disc:   { asset:'tb-disconnect.png',w:6.2,h:57,d:52, cat:'Terminals', label:'',          color:'#B3372E', bg:'#FAE3E1', pn:'UT 4-MT',       desc:'Terminal disconnect knife 4 mm²',            vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_endclamp:{asset:'tb-endclamp.png',w:9.5, h:40, d:40, cat:'Terminals', label:'',          color:'#6B7885', bg:'#EEF1F4', pn:'CLIPFIX 35',    desc:'End clamp penahan strip terminal',           vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },
    tb_partition:{asset:'tb-partition.png',w:2.2,h:52,d:47,cat:'Terminals', label:'',          color:'#6B7885', bg:'#F4F6F8', pn:'ATP-ST 2,5',    desc:'Partition plate pemisah grup terminal',      vendor:'Phoenix Contact', mount:'rail', powerW:0, dimsVerified:false },

    /* ── Front cover / door devices ──────────────────────────────────────
       w/h are the bezel footprint, not the panel cutout. Ø22 mm devices have
       a ~29 mm bezel; the E-stop is a 40 mm mushroom on a larger plate.
       Schneider Harmony XB4 range; HMI is a Mitsubishi GOT SIMPLE 7". */
    estop:      { asset:'estop-40.png',      w:60,  h:60,  d:70, cat:'Safety',   label:'E-Stop',      color:'#B3372E', bg:'#FAE3E1', pn:'XB4BS8445',   desc:'Emergency stop Ø40 mm mushroom, latching, 2 NC', vendor:'Schneider Electric', mount:'door', powerW:0,   round:true, dimsVerified:false },
    hmi:        { asset:'hmi-7in.png',       w:202, h:148, d:47, cat:'Control',  label:'HMI',         color:'#2478CE', bg:'#E3EEF9', pn:'GS2107-WTBD', desc:'HMI 7 inch TFT, Ethernet',                       vendor:'Mitsubishi Electric', mount:'door', powerW:0,   dimsVerified:false },
    disconnect: { asset:'disconnect.png',    w:65,  h:65,  d:60, cat:'Switching',label:'Main Switch', color:'#C08415', bg:'#FBEED3', pn:'KCF1PZC',     desc:'Door-mounted disconnect handle, lockable',       vendor:'Schneider Electric', mount:'door', powerW:0,   dimsVerified:false },
    pb_start:   { asset:'pb-green.png',      w:29,  h:29,  d:60, cat:'Control',  label:'Buttons',     color:'#1E7B4D', bg:'#DFF2E7', pn:'XB4BA31',     desc:'Pushbutton flush green 1 NO — START',            vendor:'Schneider Electric', mount:'door', powerW:0,   round:true, dimsVerified:false },
    pb_stop:    { asset:'pb-red.png',        w:29,  h:29,  d:60, cat:'Control',  label:'',            color:'#B3372E', bg:'#FAE3E1', pn:'XB4BA42',     desc:'Pushbutton flush red 1 NC — STOP',               vendor:'Schneider Electric', mount:'door', powerW:0,   round:true, dimsVerified:false },
    pb_reset:   { asset:'pb-blue.png',       w:29,  h:29,  d:60, cat:'Control',  label:'',            color:'#1B5FA8', bg:'#E3EEF9', pn:'XB4BA61',     desc:'Pushbutton flush blue 1 NO — RESET',             vendor:'Schneider Electric', mount:'door', powerW:0,   round:true, dimsVerified:false },
    sel_auto:   { asset:'selector-3pos.png', w:29,  h:29,  d:60, cat:'Control',  label:'Selector',    color:'#42505C', bg:'#EEF1F4', pn:'XB4BD33',     desc:'Selector switch 3-position stay-put AUTO/OFF/MAN', vendor:'Schneider Electric', mount:'door', powerW:0, round:true, dimsVerified:false },
    lamp_pwr:   { asset:'lamp-white.png',    w:29,  h:29,  d:60, cat:'Control',  label:'Pilot Lamps', color:'#6B7885', bg:'#F4F6F8', pn:'XB4BVM1',     desc:'Pilot lamp white 24 VDC LED — POWER ON',         vendor:'Schneider Electric', mount:'door', powerW:0.5, round:true, dimsVerified:false },
    lamp_run:   { asset:'lamp-green.png',    w:29,  h:29,  d:60, cat:'Control',  label:'',            color:'#1E7B4D', bg:'#DFF2E7', pn:'XB4BVM3',     desc:'Pilot lamp green 24 VDC LED — RUNNING',          vendor:'Schneider Electric', mount:'door', powerW:0.5, round:true, dimsVerified:false },
    lamp_flt:   { asset:'lamp-red.png',      w:29,  h:29,  d:60, cat:'Control',  label:'',            color:'#B3372E', bg:'#FAE3E1', pn:'XB4BVM4',     desc:'Pilot lamp red 24 VDC LED — FAULT',              vendor:'Schneider Electric', mount:'door', powerW:0.5, round:true, dimsVerified:false },

    /* ── Rest of the front-cover catalogue ───────────────────────────────
       Not auto-placed: add them from Components library → “+ Panel → Front
       cover”. Ø22 devices share the 29 mm bezel; panel meters are quoted by
       their bezel, not the cutout. `generic: true` marks a placeholder part
       number — a descriptor to be replaced with a real vendor code, never a
       fabricated one. */
    pb_black:    { asset:'pb-black.png',     w:29,  h:29,  d:60,  cat:'Control',  label:'', color:'#42505C', bg:'#EEF1F4', pn:'XB4BA21',      desc:'Pushbutton flush black 1 NO',                     vendor:'Schneider Electric', mount:'door', powerW:0,   round:true, dimsVerified:false },
    pb_yellow:   { asset:'pb-yellow.png',    w:29,  h:29,  d:60,  cat:'Control',  label:'', color:'#8A5A10', bg:'#FBEED3', pn:'XB4BA51',      desc:'Pushbutton flush yellow 1 NO',                    vendor:'Schneider Electric', mount:'door', powerW:0,   round:true, dimsVerified:false },
    pb_lit_grn:  { asset:'pb-lit-green.png', w:29,  h:29,  d:70,  cat:'Control',  label:'', color:'#1E7B4D', bg:'#DFF2E7', pn:'XB4BW33B5',    desc:'Illuminated pushbutton green 24 VDC 1 NO',        vendor:'Schneider Electric', mount:'door', powerW:0.5, round:true, dimsVerified:false },
    pb_lit_red:  { asset:'pb-lit-red.png',   w:29,  h:29,  d:70,  cat:'Control',  label:'', color:'#B3372E', bg:'#FAE3E1', pn:'XB4BW34B5',    desc:'Illuminated pushbutton red 24 VDC 1 NC',          vendor:'Schneider Electric', mount:'door', powerW:0.5, round:true, dimsVerified:false },
    pb_mushroom: { asset:'pb-mushroom.png',  w:60,  h:60,  d:70,  cat:'Control',  label:'', color:'#B3372E', bg:'#FAE3E1', pn:'XB4BT842',     desc:'Mushroom pushbutton Ø40 red, spring return',      vendor:'Schneider Electric', mount:'door', powerW:0,   round:true, dimsVerified:false },
    estop_key:   { asset:'estop-key.png',    w:60,  h:60,  d:70,  cat:'Safety',   label:'', color:'#B3372E', bg:'#FAE3E1', pn:'XB4BS9445',    desc:'Emergency stop Ø40 mm, key release, 2 NC',        vendor:'Schneider Electric', mount:'door', powerW:0,   round:true, dimsVerified:false },
    sel_2pos:    { asset:'selector-2pos.png',w:29,  h:29,  d:60,  cat:'Control',  label:'', color:'#42505C', bg:'#EEF1F4', pn:'XB4BD21',      desc:'Selector switch 2-position stay-put 1 NO',        vendor:'Schneider Electric', mount:'door', powerW:0,   round:true, dimsVerified:false },
    sel_key:     { asset:'selector-key.png', w:29,  h:29,  d:60,  cat:'Control',  label:'', color:'#42505C', bg:'#EEF1F4', pn:'XB4BG33',      desc:'Key selector switch 3-position',                  vendor:'Schneider Electric', mount:'door', powerW:0,   round:true, dimsVerified:false },
    lamp_amber:  { asset:'lamp-amber.png',   w:29,  h:29,  d:60,  cat:'Control',  label:'', color:'#8A5A10', bg:'#FBEED3', pn:'XB4BVM5',      desc:'Pilot lamp amber 24 VDC LED — WARNING',           vendor:'Schneider Electric', mount:'door', powerW:0.5, round:true, dimsVerified:false },
    lamp_blue:   { asset:'lamp-blue.png',    w:29,  h:29,  d:60,  cat:'Control',  label:'', color:'#1B5FA8', bg:'#E3EEF9', pn:'XB4BVM6',      desc:'Pilot lamp blue 24 VDC LED',                      vendor:'Schneider Electric', mount:'door', powerW:0.5, round:true, dimsVerified:false },
    potentio:    { asset:'potentiometer.png',w:29,  h:29,  d:70,  cat:'Control',  label:'', color:'#42505C', bg:'#EEF1F4', pn:'POT-22-10K',   desc:'Potentiometer Ø22 10 kΩ — speed reference',       vendor:'to be specified',    mount:'door', powerW:0,   round:true, dimsVerified:false, generic:true },
    buzzer:      { asset:'buzzer.png',       w:29,  h:29,  d:70,  cat:'Control',  label:'', color:'#42505C', bg:'#EEF1F4', pn:'BUZZ-22-24DC', desc:'Buzzer Ø22 24 VDC, 80 dB',                        vendor:'to be specified',    mount:'door', powerW:1.5, round:true, dimsVerified:false, generic:true },
    beacon:      { asset:'beacon.png',       w:70,  h:70,  d:90,  cat:'Control',  label:'', color:'#8A5A10', bg:'#FBEED3', pn:'BEACON-24DC',  desc:'Beacon / strobe 24 VDC, roof or door mounted',    vendor:'to be specified',    mount:'door', powerW:3,   round:true, dimsVerified:false, generic:true },
    hmi4:        { asset:'hmi-4in.png',      w:130, h:105, d:44,  cat:'Control',  label:'', color:'#2478CE', bg:'#E3EEF9', pn:'GS2104-WTBD',  desc:'HMI 4.3 inch TFT, Ethernet',                      vendor:'Mitsubishi Electric',mount:'door', powerW:0,   dimsVerified:false },
    hmi10:       { asset:'hmi-10in.png',     w:272, h:214, d:52,  cat:'Control',  label:'', color:'#2478CE', bg:'#E3EEF9', pn:'GS2110-WTBD',  desc:'HMI 10.4 inch TFT, Ethernet',                     vendor:'Mitsubishi Electric',mount:'door', powerW:0,   dimsVerified:false },
    meter_a:     { asset:'ammeter-96.png',   w:96,  h:96,  d:60,  cat:'Control',  label:'', color:'#42505C', bg:'#EEF1F4', pn:'AMP-96-ANALOG',desc:'Analogue ammeter 96×96 mm (cutout 92×92)',        vendor:'to be specified',    mount:'door', powerW:0,   dimsVerified:false, generic:true },
    meter_v:     { asset:'voltmeter-96.png', w:96,  h:96,  d:60,  cat:'Control',  label:'', color:'#42505C', bg:'#EEF1F4', pn:'VOLT-96-ANALOG',desc:'Analogue voltmeter 96×96 mm (cutout 92×92)',     vendor:'to be specified',    mount:'door', powerW:0,   dimsVerified:false, generic:true },
    meter_pwr:   { asset:'power-meter-96.png',w:96, h:96,  d:70,  cat:'Control',  label:'', color:'#2478CE', bg:'#E3EEF9', pn:'PM2120',       desc:'Power / energy meter 96×96 mm, Modbus',           vendor:'Schneider Electric', mount:'door', powerW:3,   dimsVerified:false },
    meter_hour:  { asset:'hour-meter.png',   w:48,  h:48,  d:60,  cat:'Control',  label:'', color:'#42505C', bg:'#EEF1F4', pn:'HOUR-48',      desc:'Hour run meter 48×48 mm',                         vendor:'to be specified',    mount:'door', powerW:0.5, dimsVerified:false, generic:true },
    temp_ctrl:   { asset:'temp-ctrl-48.png', w:48,  h:48,  d:80,  cat:'Control',  label:'', color:'#8A5A10', bg:'#FBEED3', pn:'TEMP-CTRL-48', desc:'Temperature controller 48×48 mm, PID',            vendor:'to be specified',    mount:'door', powerW:4,   dimsVerified:false, generic:true },
    door_lock:   { asset:'door-lock.png',    w:30,  h:30,  d:40,  cat:'Mechanical',label:'',color:'#6B7885', bg:'#EEF1F4', pn:'DOOR-LOCK-KEY',desc:'Door lock, key operated',                         vendor:'to be specified',    mount:'door', powerW:0,   dimsVerified:false, generic:true },
    window:      { asset:'window.png',       w:200, h:150, d:20,  cat:'Mechanical',label:'',color:'#6B7885', bg:'#F4F6F8', pn:'WINDOW-200x150',desc:'Inspection window with gasket, IP55',            vendor:'to be specified',    mount:'door', powerW:0,   dimsVerified:false, generic:true },
    socket:      { asset:'socket.png',       w:50,  h:50,  d:60,  cat:'Power',    label:'', color:'#C08415', bg:'#FBEED3', pn:'SOCKET-230V',  desc:'Service socket 230 V, panel mounted',             vendor:'to be specified',    mount:'door', powerW:0,   dimsVerified:false, generic:true },
    port_eth:    { asset:'port-rj45.png',    w:29,  h:29,  d:50,  cat:'Network',  label:'', color:'#0F7A6C', bg:'#DDF1EE', pn:'PORT-RJ45-22', desc:'RJ45 service coupler Ø22, IP65 cap',              vendor:'to be specified',    mount:'door', powerW:0,   round:true, dimsVerified:false, generic:true },
    port_usb:    { asset:'port-usb.png',     w:29,  h:29,  d:50,  cat:'Network',  label:'', color:'#0F7A6C', bg:'#DDF1EE', pn:'PORT-USB-22',  desc:'USB programming coupler Ø22, IP65 cap',           vendor:'to be specified',    mount:'door', powerW:0,   round:true, dimsVerified:false, generic:true },
  };
  /* Door devices never consume backplate space; they are laid out separately.
     Derived, so adding a door component to the database is enough. */
  const DOOR_KEYS = Object.keys(COMPONENT_DB)
    .filter((k) => COMPONENT_DB[k].mount === 'door' && k !== 'fan');

  /* Reference designation prefixes, loosely IEC 81346:
     Q switching/protection · F fuse-overload · G supply · K relay/contactor
     A assembly (CPU, module, HMI) · S control switch · H indicator · T converter
     E cooling. Devices of one kind number in placement order, so the drawing,
     the schedule and the BOM all say the same thing. */
  const DESIGNATION = {
    mccb: 'Q', mcb3: 'Q', mcb1: 'Q', disconnect: 'Q',
    spd: 'F', overload: 'F',
    psu: 'G',
    contactor: 'K', safety: 'K', irelay: 'KA',
    plc: 'A', di16: 'A', do16: 'A', ad4: 'A', da4: 'A', eth: 'A', hmi: 'HMI',
    estop: 'S', sel_auto: 'S', pb_start: 'S', pb_stop: 'S', pb_reset: 'S',
    lamp_pwr: 'H', lamp_run: 'H', lamp_flt: 'H',
    vfd: 'T', servo: 'T',
    fan: 'E', filter_out: 'V',
  };
  /* Fixed numbers for the door devices, so START is always S3 on every drawing */
  const DOOR_TAG = { disconnect: 'Q1', estop: 'S1', sel_auto: 'S2',
                     pb_start: 'S3', pb_stop: 'S4', pb_reset: 'S5',
                     lamp_pwr: 'H1', lamp_run: 'H2', lamp_flt: 'H3' };

  /* Stable identity per placed device: type plus its ordinal among its kind.
     Manual door positions are keyed on this, so they survive a reorder. */
  function designate(items, fixed, spec) {
    const perKind = {}, perPrefix = {};
    /* key sintesis (vfd_400_5k5, contactor_LC1D18BD) mewarisi prefix induknya */
    const baseOf = (t) => (spec && spec(t) && spec(t).baseKey) || t;
    return items.map((it) => {
      perKind[it.type] = (perKind[it.type] || 0) + 1;
      const ord = perKind[it.type];
      const id = it.type + '#' + ord;
      let tag;
      const base = baseOf(it.type);
      if (fixed && fixed[base]) {
        const total = items.filter((x) => x.type === it.type).length;
        tag = fixed[base] + (total > 1 ? '.' + ord : '');
      } else {
        const p = DESIGNATION[it.type] || DESIGNATION[base] || 'X';
        perPrefix[p] = (perPrefix[p] || 0) + 1;
        tag = p + perPrefix[p];
      }
      return Object.assign({}, it, { id, tag });
    });
  }

  /* ══════════ IEC 60204-1 §13.2 WIRE COLOURS ══════════ */
  const WIRE_COLOUR = {
    power:     'Black',
    neutral:   'Light blue',
    acControl: 'Red',
    dcControl: 'Dark blue',
    interlock: 'Orange',
    pe:        'Green-yellow',
  };

  const DEFAULT_CFG = {
    plc: 'plc',       /* key komponen ber-isPlc, atau 'none' */
    di: 24, do_: 16, ai: 4, ao: 2,
    vfd: 3, servo: 2, hmi: 2, motor: 6, valve: 5,
    supplyV: 400,     /* 3-phase line voltage at the incoming terminals */
    ambientC: 30,     /* design ambient outside the enclosure */
    cabW: 800,        /* per-project, was a global setting */
    cabH: 0,          /* 0 = derive height from the layout; else a fixed size */
    /* Daftar beban bermotor — SUMBER KEBENARAN untuk arus, proteksi, panas dan
       ukuran drive. [{kind:'vfd'|'servo'|'dol', kW, qty}]. Kalau kosong, ia
       disintesis dari hitungan lama (vfd/servo/motor) memakai rating asumsi,
       jadi proyek lama tetap menghasilkan angka yang sama persis. */
    loads: [],
    /* [{type, qty, place, rail}] — library components added by hand.
       place 'plate' uses rail 1–3; place 'door' goes on the front cover. */
    extras: [],
    doorPos: {},      /* {'estop#1': {x,y}} — manual front-cover placement, mm */
    platePos: {},     /* {'mccb#1': {x, row}} — manual backplate X + pilihan rail */
    sidePos: {},      /* {'fan#1': {x,y,side}} — manual placement di panel sisi */
  };
  const NO_PLC = 'none';
  /* Rating yang dulu diasumsikan global; sekarang hanya dipakai untuk
     memigrasikan proyek lama yang belum punya daftar beban. */
  const DEFAULT_RATING = { vfd: 2.2, servo: 0.75, dol: 1.5 };
  /* Nama PLC versi lama (sebelum PLC jadi komponen library) → key komponen */
  const LEGACY_PLC = {
    'Mitsubishi FX5U': 'plc',
    'Mitsubishi FX5UJ': 'plc_fx5uj40',
  };
  const isPlcKey = (db, k) => !!(db[k] && db[k].isPlc);

  /* Base used when the library defines a component the built-in DB never had.
     Deliberately unflattering defaults so an unfilled field is obvious. */
  const BLANK_COMPONENT = {
    asset: '', w: 45, h: 80, d: 70, cat: 'Custom', label: '',
    color: '#6B7885', bg: '#EEF1F4', pn: '', desc: 'Custom component',
    vendor: '', mount: 'rail', powerW: 0, dimsVerified: false, custom: true,
  };

  /* ══════════ HELPERS ══════════ */
  const num = (v, dflt) => (Number.isFinite(+v) ? +v : dflt);
  const clampInt = (v) => Math.max(0, Math.round(num(v, 0)));
  const pickAtLeast = (list, need, key) =>
    list.find((x) => x[key] >= need) || list[list.length - 1];

  /* Fills defaults so projects saved before a field existed still compute.
     Never mutates the caller's object. */
  function normalizeCfg(raw) {
    const c = Object.assign({}, DEFAULT_CFG, raw || {});
    ['di', 'do_', 'ai', 'ao', 'vfd', 'servo', 'hmi', 'motor', 'valve']
      .forEach((k) => { c[k] = clampInt(c[k]); });
    c.supplyV = num(c.supplyV, 400);
    c.ambientC = num(c.ambientC, 30);
    c.cabW = num(c.cabW, 800);
    c.cabH = Math.max(0, num(c.cabH, 0));
    /* Proyek lama menyimpan nama tampilan ('Mitsubishi FX5U'); sekarang yang
       disimpan adalah key komponen, supaya dropdown dan library satu sumber. */
    if (LEGACY_PLC[c.plc]) c.plc = LEGACY_PLC[c.plc];
    /* Kosong / hilang BUKAN berarti "tanpa PLC" — itu berarti belum diisi, jadi
       pakai default. Hanya NO_PLC yang berarti panel tanpa CPU. Tanpa penjagaan
       ini, plc yang undefined (mis. dropdown belum terisi saat form dibaca)
       diam-diam mengubah panel ber-PLC menjadi panel relay. */
    if (typeof c.plc !== 'string' || !c.plc) c.plc = DEFAULT_CFG.plc;
    c.hasPlc = c.plc !== NO_PLC;
    /* Only 200 V and 400 V classes are in the drive tables */
    c.voltClass = c.supplyV <= 300 ? 200 : 400;
    /* Manual door positions: keep only well-formed numeric pairs, so a corrupt
       entry cannot push a device to NaN and blank the drawing. */
    const dp = {};
    for (const k of Object.keys(c.doorPos || {})) {
      const p = c.doorPos[k];
      if (p && Number.isFinite(+p.x) && Number.isFinite(+p.y))
        dp[k] = { x: +p.x, y: +p.y };
    }
    c.doorPos = dp;
    /* Posisi manual di backplate: X bebas (dibulatkan ke langkah 2 mm oleh UI),
       `row` memilih rail ke berapa. Entri rusak dibuang. */
    const pp = {};
    for (const k of Object.keys(c.platePos || {})) {
      const p = c.platePos[k];
      if (!p) continue;
      const e = {};
      if (Number.isFinite(+p.x)) e.x = +p.x;
      if (Number.isInteger(+p.row) && +p.row >= 0) e.row = +p.row;
      if (Object.keys(e).length) pp[k] = e;
    }
    c.platePos = pp;
    /* Posisi manual di panel sisi. `side` opsional — kalau ada harus valid. */
    const sp = {};
    for (const k of Object.keys(c.sidePos || {})) {
      const p = c.sidePos[k];
      if (p && Number.isFinite(+p.x) && Number.isFinite(+p.y))
        sp[k] = Object.assign({ x: +p.x, y: +p.y },
          (p.side === 'left' || p.side === 'right') ? { side: p.side } : {});
    }
    c.sidePos = sp;
    /* ── Daftar beban ────────────────────────────────────────────────────
       Bersihkan dulu; kalau kosong, sintesis dari hitungan lama supaya proyek
       yang sudah ada menghasilkan desain yang identik. Sesudah itu hitungan
       vfd/servo/motor DITURUNKAN dari daftar, bukan sebaliknya — satu sumber. */
    const KINDS = ['vfd', 'servo', 'dol'];
    let loads = (Array.isArray(c.loads) ? c.loads : [])
      .filter((l) => l && KINDS.indexOf(l.kind) >= 0 && num(l.kW, 0) > 0)
      .map((l) => ({ kind: l.kind,
                     kW: Math.round(num(l.kW, 0) * 1000) / 1000,
                     qty: Math.max(1, clampInt(l.qty) || 1) }));
    if (!loads.length) {
      const nv = clampInt(raw && raw.vfd), ns = clampInt(raw && raw.servo);
      const nm = clampInt(raw && raw.motor);
      const nd = Math.max(0, nm - nv - ns);
      if (nv) loads.push({ kind: 'vfd',   kW: DEFAULT_RATING.vfd,   qty: nv });
      if (ns) loads.push({ kind: 'servo', kW: DEFAULT_RATING.servo, qty: ns });
      if (nd) loads.push({ kind: 'dol',   kW: DEFAULT_RATING.dol,   qty: nd });
    }
    c.loads = loads;
    const countOf = (k) => loads.filter((l) => l.kind === k)
                                .reduce((t, l) => t + l.qty, 0);
    c.vfd = countOf('vfd');
    c.servo = countOf('servo');
    c.dolCount = countOf('dol');
    c.motor = c.vfd + c.servo + c.dolCount;
    c.extras = (Array.isArray(c.extras) ? c.extras : [])
      .filter((e) => e && e.type)
      .map((e) => ({
        type: String(e.type),
        qty: Math.max(1, clampInt(e.qty) || 1),
        /* entries saved before the front cover existed have no place */
        place: ['door', 'left', 'right'].indexOf(e.place) >= 0 ? e.place : 'plate',
        /* rail 4 = strip terminal block */
        rail: [1, 2, 3, 4].indexOf(+e.rail) >= 0 ? +e.rail : 2,
      }));
    return c;
  }

  /* Merge the user's library on top of the built-in database. Patches may edit
     an existing component (corrected dimensions from a datasheet) or introduce
     an entirely new key. */
  function resolveDb(patch) {
    const db = Object.assign({}, COMPONENT_DB);
    for (const k of Object.keys(patch || {})) {
      db[k] = Object.assign({}, COMPONENT_DB[k] || BLANK_COMPONENT, patch[k]);
      /* numeric fields may arrive as strings from a form */
      ['w', 'h', 'd', 'powerW'].forEach((f) => { db[k][f] = num(db[k][f], 0); });
    }
    return db;
  }

  /* ══════════ ELECTRICAL ══════════
     Every load is reduced to real input power and apparent power, then summed.
     Total current comes from ΣS, not from an assumed blanket power factor —
     the resulting PF is an output, not an input. */
  /* Satu baris skedul per ENTRI beban, jadi rating campur benar-benar terbawa
     ke arus, breaker, kabel dan panas. */
  function loadSchedule(c, A) {
    const V = c.supplyV, root3 = Math.sqrt(3);
    const rows = [];
    const PROP = {
      vfd:   { pf: A.pf.vfd,   eff: A.eff.vfdDrive * A.eff.vfdMotor,   label: 'VFD' },
      servo: { pf: A.pf.servo, eff: A.eff.servoDrive * A.eff.servoMotor, label: 'Servo' },
      dol:   { pf: A.pf.dol,   eff: A.eff.dolMotor,                    label: 'Motor DOL' },
    };
    for (const l of c.loads) {
      const p = PROP[l.kind];
      const shaftW = l.kW * 1000;
      const pIn = shaftW / p.eff;               /* real power drawn per unit */
      const s = pIn / p.pf;                     /* apparent power per unit */
      const a = s / (root3 * V);                /* line current per unit */
      rows.push({
        kind: l.kind, kW: l.kW,
        name: p.label + ' ' + l.kW + ' kW',
        qty: l.qty, shaftW, pf: p.pf, eff: p.eff,
        pInEach: pIn, pIn: pIn * l.qty,
        sEach: s, s: s * l.qty,
        aEach: a, a: a * l.qty,
        /* hanya DOL yang punya inrush rotor terkunci */
        startEach: l.kind === 'dol' ? a * A.dolStartMultiple : a,
      });
    }
    return { rows, dol: c.dolCount };
  }

  /* 24 V budget, split by where the heat ends up.
     internal = dissipated inside the enclosure (counts toward thermal load)
     external = field devices, dissipated outside (does NOT heat the panel) */
  function dcBudget(c, counts, A, db) {
    const D = db || COMPONENT_DB;
    const extras = (c.extras || []).map((e) => ({
      name: 'Added: ' + ((D[e.type] && D[e.type].desc) || e.type) +
            (e.qty > 1 ? ' ×' + e.qty : ''),
      w: ((D[e.type] && D[e.type].powerW) || 0) * e.qty,
    }));
    const lampCount = 2 + Math.max(1, 1 + counts.dol);   /* power + fault + run(s) */
    const internal = extras.concat([
      { name: 'PLC CPU',             w: counts.hasPlc ? D.plc.powerW : 0 },
      { name: 'DI expansion',        w: counts.diExtra * D.di16.powerW },
      { name: 'DO expansion',        w: counts.doExtra * D.do16.powerW },
      { name: 'Analog in modules',   w: counts.aiMods * D.ad4.powerW },
      { name: 'Analog out modules',  w: counts.aoMods * D.da4.powerW },
      { name: 'Ethernet switch',     w: (counts.hasPlc || c.hmi > 0) ? D.eth.powerW : 0 },
      { name: 'Safety relay',        w: D.safety.powerW },
      { name: 'Interface relays',    w: counts.relays * D.irelay.powerW },
      { name: 'Contactor coils',     w: counts.dol * D.contactor.powerW },
      { name: 'HMI (door)',          w: c.hmi * 15 },
      { name: 'Pilot lamps (door)',  w: lampCount * (D.lamp_pwr.powerW || 0) },
    ]).filter((x) => x.w > 0);

    /* Field devices. One PNP sensor per DI at ~25 mA; one pilot solenoid per
       valve at 2.5 W. Sized at 100% coincidence — no diversity credit, because
       the PSU has to survive the worst case. */
    const external = [
      { name: 'DI field sensors', w: c.di * 0.6 },
      { name: 'Solenoid valves',  w: c.valve * 2.5 },
    ].filter((x) => x.w > 0);

    const sum = (a) => a.reduce((t, x) => t + x.w, 0);
    const wInternal = sum(internal), wExternal = sum(external);
    return {
      internal, external, wInternal, wExternal,
      wTotal: wInternal + wExternal,
      aTotal: (wInternal + wExternal) / 24,
    };
  }

  function selectPsu(dcAmps, ambientC, A) {
    /* QUINT-class supplies hold full output to ~45 °C, then derate ~2%/K.
       Cabinet air, not room air, is what the supply actually sees. */
    const derate = ambientC <= 45 ? 1 : Math.max(0.6, 1 - (ambientC - 45) * 0.02);
    const need = dcAmps / (A.psuMaxUtil * derate);
    const psu = pickAtLeast(PSU_LADDER, need, 'a');
    return {
      pn: psu.pn, ratedA: psu.a, w: psu.w, h: psu.h, d: psu.d,
      derate, requiredA: need,
      utilPct: psu.a > 0 ? (dcAmps / (psu.a * derate)) * 100 : 0,
      undersized: psu.a * derate < dcAmps,
    };
  }

  function selectMccb(flcA, A) {
    const need = flcA * A.breakerMargin;
    for (const f of MCCB_FRAMES) {
      const trip = f.trips.find((t) => t >= need);
      if (trip) return { pn: f.pn + '-3P-' + trip + 'A', frame: f.frame, tripA: trip,
                         w: f.w, h: f.h, d: f.d, requiredA: need, overRange: false };
    }
    const last = MCCB_FRAMES[MCCB_FRAMES.length - 1];
    return { pn: last.pn + '-3P-' + last.frame + 'A', frame: last.frame,
             tripA: last.frame, w: last.w, h: last.h, d: last.d,
             requiredA: need, overRange: true };
  }

  const selectMcb = (aNeeded, poles) => {
    const trip = MCB_TRIPS.find((t) => t >= aNeeded) || MCB_TRIPS[MCB_TRIPS.length - 1];
    return { pn: 'MCB-' + poles + 'P-C' + trip, tripA: trip, poles };
  };

  function selectStarter(kw, flcA) {
    const k = CONTACTORS.find((x) => x.kw400 >= kw && x.ac3A >= flcA) ||
              CONTACTORS[CONTACTORS.length - 1];
    const ol = OVERLOADS.find((x) => x.min <= flcA && x.max >= flcA) ||
               OVERLOADS[OVERLOADS.length - 1];
    return { contactor: k, overload: ol, setA: flcA };
  }

  /* ══════════ THERMAL ══════════
     Practical form of IEC 60890: the enclosure sheds heat through an effective
     surface Ae, weighted per face by exposure. ΔT = P / (k · Ae), so a bigger
     cabinet really does run cooler — which the old `30 + heat/40` could not
     express. */
  function effectiveSurfaceM2(W, H, D, freeStanding) {
    const w = W / 1000, h = H / 1000, d = D / 1000;
    const faces = [
      { a: w * d, b: 1.4 },                       /* top, exposed */
      { a: w * h, b: 0.9 },                       /* front */
      { a: h * d, b: 0.9 }, { a: h * d, b: 0.9 }, /* both sides */
      { a: w * h, b: 0.5 },                       /* back, against a wall */
      { a: w * d, b: freeStanding ? 0 : 0.5 },    /* bottom */
    ];
    return faces.reduce((t, f) => t + f.a * f.b, 0);
  }

  function thermal(heatW, dims, ambientC, A) {
    const Ae = effectiveSurfaceM2(dims.W, dims.H, dims.D, dims.freeStanding);
    const surfaceWperK = A.kEnclosure * Ae;
    const allowedDT = A.maxInternalC - ambientC;
    const M3H_TO_CFM = 0.588;

    /* Steady-state balance: the heat leaves through the skin AND through the
       air the fans move.   P = (k·Ae)·ΔT + (V̇/3.1)·ΔT
       so  ΔT = P / (k·Ae + V̇/3.1).  V̇ = 0 gives the natural-convection case,
       which is why one formula covers both. */
    const dtAt = (m3h) => heatW / (surfaceWperK + m3h / A.airConstant);

    const naturalDT = dtAt(0);
    const naturalC = ambientC + naturalDT;
    const base = { Ae, surfaceWperK, naturalDT, naturalC, allowedDT };

    /* A filter fan pushes room air through the box — it can never get the
       inside below ambient, so if ambient already exceeds the ceiling no amount
       of airflow helps. */
    if (allowedDT <= 0) {
      return Object.assign({}, base, { method: 'cooling-unit', fans: 0,
        requiredM3h: 0, requiredCfm: 0, insideC: naturalC,
        note: 'Ambient ' + ambientC + ' °C is at or above the ' + A.maxInternalC +
              ' °C design ceiling — forced air cannot help. Specify an air ' +
              'conditioner or air/water heat exchanger.' });
    }
    if (naturalDT <= allowedDT) {
      return Object.assign({}, base, { method: 'natural', fans: 0,
        requiredM3h: 0, requiredCfm: 0, insideC: naturalC,
        note: 'Natural convection is sufficient (' + naturalDT.toFixed(1) +
              ' K rise vs ' + allowedDT.toFixed(1) + ' K allowed); ' +
              'louvred vents only.' });
    }

    /* Airflow that lands exactly on the ceiling, then margin for clogged
       filters and fan ageing. */
    const idealM3h = A.airConstant * (heatW / allowedDT - surfaceWperK);
    const requiredM3h = idealM3h * A.fanMargin;
    const fans = Math.max(1, Math.ceil(requiredM3h / A.fanFlowM3h));

    if (fans > A.maxFans) {
      return Object.assign({}, base, { method: 'cooling-unit', fans: 0,
        idealM3h, requiredM3h, requiredCfm: requiredM3h * M3H_TO_CFM,
        insideC: naturalC,
        note: Math.round(requiredM3h) + ' m³/h needs more than ' + A.maxFans +
              ' filter fans — specify a cooling unit instead.' });
    }

    const deliveredM3h = fans * A.fanFlowM3h;
    const achievedDT = dtAt(deliveredM3h);
    return Object.assign({}, base, { method: 'forced', fans,
      idealM3h, requiredM3h, requiredCfm: requiredM3h * M3H_TO_CFM,
      deliveredM3h, deliveredCfm: deliveredM3h * M3H_TO_CFM,
      achievedDT, insideC: ambientC + achievedDT,
      note: fans + ' × 150 mm filter fan with matching outlet filter — ' +
            Math.round(requiredM3h) + ' m³/h (' +
            Math.round(requiredM3h * M3H_TO_CFM) + ' CFM) required, ' +
            Math.round(deliveredM3h) + ' m³/h fitted, ' +
            achievedDT.toFixed(1) + ' K rise.' });
  }

  /* ══════════ LAYOUT ══════════
     Rows wrap when they run out of width, so a crowded design grows the
     cabinet instead of drawing components past the enclosure wall. */
  function packRows(list, usableW, gap, specs) {
    const out = [];
    let cur = [], x = 0;
    for (const t of list) {
      const w = specs(t).w;
      if (cur.length && x + w > usableW) { out.push(cur); cur = []; x = 0; }
      cur.push(t);
      x += w + gap;
    }
    if (cur.length) out.push(cur);
    return out.length ? out : [[]];
  }

  /* ══════════ MAIN ══════════ */
  function compute(rawCfg, overrides) {
    const o = overrides || {};
    /* `components` is library data, not an assumption — keep it out of A */
    const componentPatch = o.components || {};
    const assumptionOverrides = {};
    for (const k of Object.keys(o)) if (k !== 'components') assumptionOverrides[k] = o[k];
    const A = deepMerge(ASSUMPTIONS, assumptionOverrides);
    const db = resolveDb(componentPatch);
    const c = normalizeCfg(rawCfg);
    const warnings = [];
    const L = A.layout;
    const GAP = L.gap, PAD = L.pad, GAPV = L.gapV,
          DUCT = L.ductH, TSTRIP = L.tstripH;
    const W = c.cabW;

    /* ── CPU terpilih ──────────────────────────────────────────────── */
    let plcKey = c.hasPlc ? c.plc : null;
    if (plcKey && !isPlcKey(db, plcKey)) {
      warnings.push({ level: 'error', code: 'PLC_UNKNOWN',
        msg: 'CPU "' + plcKey + '" tidak ada di library (atau bukan PLC). ' +
             'Pilih ulang di Panel designer.' });
      plcKey = null;
    }
    const cpu = plcKey ? db[plcKey] : null;

    /* ── module counts ─────────────────────────────────────────────── */
    const hasPlc = !!cpu;
    /* Without a CPU there is no I/O rack at all — a relay-logic or purely
       motor-starter panel. The I/O figures are kept in the config (so nothing
       is destroyed if a PLC is chosen again) but they buy no hardware. */
    /* I/O bawaan CPU dulu; sisanya baru dibelikan modul ekspansi. */
    const bDi = cpu ? num(cpu.builtinDi, 0) : 0;
    const bDo = cpu ? num(cpu.builtinDo, 0) : 0;
    const expDiKey = (cpu && cpu.expDi) || 'di16';
    const expDoKey = (cpu && cpu.expDo) || 'do16';
    const expAiKey = (cpu && cpu.expAi) || 'ad4';
    const expAoKey = (cpu && cpu.expAo) || 'da4';
    const perDi = hasPlc ? Math.max(1, num(db[expDiKey] && db[expDiKey].channels, 16)) : 16;
    const perDo = hasPlc ? Math.max(1, num(db[expDoKey] && db[expDoKey].channels, 16)) : 16;
    const diExtra = hasPlc ? Math.ceil(Math.max(0, c.di - bDi) / perDi) : 0;
    const doExtra = hasPlc ? Math.ceil(Math.max(0, c.do_ - bDo) / perDo) : 0;
    const aiMods  = hasPlc ? Math.ceil(c.ai / 4) : 0;
    const aoMods  = hasPlc ? Math.ceil(c.ao / 4) : 0;
    const relays  = c.valve;                  /* one per solenoid, no cap */
    const dol     = Math.max(0, c.motor - c.vfd - c.servo);
    const expansionModules = diExtra + doExtra + aiMods + aoMods;
    const maxExp = cpu ? num(cpu.maxExp, A.maxExpansionModules) : A.maxExpansionModules;
    const counts = { diExtra, doExtra, aiMods, aoMods, relays, dol, hasPlc,
                     plcKey, expDiKey, expDoKey, expAiKey, expAoKey, builtinDi: bDi,
                     builtinDo: bDo };

    if (!hasPlc && (c.di || c.do_ || c.ai || c.ao))
      warnings.push({ level: 'warn', code: 'IO_WITHOUT_PLC',
        msg: 'No PLC selected, so the ' + (c.di + c.do_ + c.ai + c.ao) +
             ' configured I/O points buy no modules and are not wired to a CPU. ' +
             'Field devices are still terminated on the terminal strip.' });
    if (!hasPlc && c.hmi > 0)
      warnings.push({ level: 'warn', code: 'HMI_WITHOUT_PLC',
        msg: c.hmi + ' HMI configured without a PLC — it has nothing to talk to. ' +
             'Remove it or select a PLC.' });
    if (expansionModules > maxExp)
      warnings.push({ level: 'error', code: 'BUS_LIMIT',
        msg: expansionModules + ' modul ekspansi melebihi batas ' + maxExp +
             ' pada ' + ((cpu && cpu.plcName) || 'CPU ini') +
             '. Pakai CPU dengan I/O bawaan lebih banyak, atau remote I/O.' });
    /* Modul ekspansi generik → part number harus dipilih sesuai vendor CPU */
    if (hasPlc && expansionModules > 0 &&
        [expDiKey, expDoKey, expAiKey, expAoKey].some((k) => db[k] && db[k].generic))
      warnings.push({ level: 'warn', code: 'EXP_GENERIC',
        msg: 'Modul ekspansi untuk ' + (cpu.plcName || cpu.pn) + ' masih generik — ' +
             'pilih part number ' + cpu.vendor + ' yang sesuai di Components library.' });
    if (c.do_ < c.valve)
      warnings.push({ level: 'error', code: 'DO_SHORT',
        msg: c.valve + ' solenoids need ' + c.valve + ' outputs but only ' +
             c.do_ + ' DO are configured.' });
    if (c.motor < c.vfd + c.servo)
      warnings.push({ level: 'warn', code: 'MOTOR_COUNT',
        msg: 'Drive count (' + (c.vfd + c.servo) + ') exceeds the motor count (' +
             c.motor + '); no DOL starters generated.' });

    /* ── electrical ────────────────────────────────────────────────── */
    const sched = loadSchedule(c, A);
    const dc = dcBudget(c, counts, A, db);

    /* PSU AC input as a load, so the incoming breaker sees the whole panel */
    const psuPIn = dc.wTotal / A.eff.psu;
    const psuS = psuPIn / A.pf.psu;
    const psuA = psuS / (Math.sqrt(3) * c.supplyV);
    sched.rows.push({ name: 'Control 24 VDC via PSU', qty: 1, shaftW: dc.wTotal,
      pf: A.pf.psu, eff: A.eff.psu, pInEach: psuPIn, pIn: psuPIn,
      sEach: psuS, s: psuS, aEach: psuA, a: psuA, startEach: psuA });

    const totalPIn = sched.rows.reduce((t, r) => t + r.pIn, 0);
    const totalS   = sched.rows.reduce((t, r) => t + r.s, 0);
    const flcA     = totalS / (Math.sqrt(3) * c.supplyV);
    const systemPf = totalS > 0 ? totalPIn / totalS : 1;

    /* Starting current: largest starting load inrushing while the rest runs.
       This is the number that sizes a generator or upstream transformer. */
    let startA = flcA, worstDelta = 0;
    for (const r of sched.rows) {
      const delta = (r.startEach - r.aEach);
      if (r.qty > 0 && delta > worstDelta) worstDelta = delta;
    }
    startA = flcA + worstDelta;

    /* ── protection ────────────────────────────────────────────────── */
    const mccb = selectMccb(flcA, A);
    if (mccb.overRange)
      warnings.push({ level: 'error', code: 'MCCB_RANGE',
        msg: 'Required ' + mccb.requiredA.toFixed(1) + ' A exceeds the largest ' +
             'frame in the table; specify the incoming device manually.' });

    const driveA = sched.rows
      .filter((r) => /VFD|Servo/.test(r.name))
      .reduce((t, r) => t + r.a, 0);
    const driveMcb = selectMcb(driveA * A.breakerMargin, 3);
    /* Control branch is single-phase L-N, so the reference voltage is the phase
       voltage. Floored at minControlMcbA for PSU inrush. */
    const controlA = psuPIn / (c.supplyV / Math.sqrt(3));
    const controlMcb = selectMcb(
      Math.max(controlA * A.breakerMargin, A.minControlMcbA), 1);
    controlMcb.steadyA = controlA;

    /* ── Satu drive / starter PER ENTRI beban, sesuai rating masing-masing ── */
    const drivePicks = [];                       /* {key, spec, qty} untuk rail 3 */
    const starterPicks = [];                     /* {contactorKey, overloadKey, qty} */
    let starter = null;                          /* starter pertama, untuk ringkasan */
    for (const l of c.loads) {
      if (l.kind === 'dol') {
        const flc = (l.kW * 1000 / A.eff.dolMotor) /
                    (Math.sqrt(3) * c.supplyV * A.pf.dol);
        const st = selectStarter(l.kW, flc);
        st.kW = l.kW;
        starterPicks.push({ st, qty: l.qty });
        if (!starter) starter = st;
        continue;
      }
      const d = pickDrive(l.kind, l.kW, c.voltClass);
      d.wantKw = l.kW;
      drivePicks.push({ d, qty: l.qty, kind: l.kind });
      if (d.over)
        warnings.push({ level: 'warn', code: 'DRIVE_OVER_RANGE',
          msg: l.kW + ' kW melebihi frame terbesar di kelas ' + c.voltClass +
               ' V; memakai ' + d.pn + ' (' + d.ratedKw + ' kW). Pilih drive ' +
               'secara manual atau naikkan tegangan supply.' });
      else if (d.ratedKw > l.kW + 1e-9)
        warnings.push({ level: 'info', code: 'DRIVE_FRAME',
          msg: 'Tidak ada frame ' + l.kW + ' kW di kelas ' + c.voltClass +
               ' V; memakai frame terdekat di atasnya (' + d.pn + ', ' +
               d.ratedKw + ' kW).' });
    }

    /* Resolve the live selections into the component specs used for layout */
    const specs = Object.assign({}, db);
    const psuPick = selectPsu(dc.aTotal, c.ambientC, A);
    specs.mccb  = ov(specs.mccb,  { pn: mccb.pn, w: mccb.w, h: mccb.h, d: mccb.d,
                                    desc: 'Main breaker MCCB 3P ' + mccb.tripA + ' A' });
    specs.psu   = ov(specs.psu,   { pn: psuPick.pn, w: psuPick.w, h: psuPick.h,
                                    d: psuPick.d,
                                    desc: 'Power supply 24 VDC ' + psuPick.ratedA + ' A' });
    /* Satu spec per model drive terpilih. `baseKey` membuat gambar yang sudah
       kamu unggah untuk `vfd`/`servo` tetap terpakai sebagai cadangan. */
    for (const { d, kind } of drivePicks) {
      specs[d.key] = ov(specs[kind], {
        pn: d.pn, w: d.w, h: d.h, d: d.d, baseKey: kind,
        desc: (kind === 'servo' ? 'Servo amplifier ' : 'Inverter VFD ') +
              d.ratedKw + ' kW ' + c.voltClass + ' V',
      });
    }
    /* Sama untuk starter DOL: motor 5,5 kW butuh kontaktor lebih besar daripada
       motor 1,5 kW — dulu semuanya memakai satu ukuran. */
    for (const { st } of starterPicks) {
      st.cKey = 'contactor_' + st.contactor.pn;
      st.oKey = 'overload_' + st.overload.pn;
      specs[st.cKey] = ov(specs.contactor, {
        pn: st.contactor.pn, w: st.contactor.w, h: st.contactor.h,
        d: st.contactor.d, baseKey: 'contactor',
        desc: 'Contactor ' + st.contactor.ac3A + ' A AC-3 (' + st.kW +
              ' kW), coil 24 VDC' });
      specs[st.oKey] = ov(specs.overload, {
        pn: st.overload.pn, baseKey: 'overload',
        desc: 'Thermal overload ' + st.overload.min + '–' + st.overload.max +
              ' A, set ' + st.setA.toFixed(1) + ' A' });
    }
    specs.mcb3  = ov(specs.mcb3,  { pn: driveMcb.pn,
                                    desc: 'MCB 3P C' + driveMcb.tripA + ' drives feeder' });
    specs.mcb1  = ov(specs.mcb1,  { pn: controlMcb.pn,
                                    desc: 'MCB 1P C' + controlMcb.tripA + ' control' });

    /* Re-apply the library patch LAST so a corrected datasheet dimension wins
       over the size that came from the selection table. Pinning is intentional:
       if you tell the tool a part is 132 mm wide, it lays out 132 mm. */
    for (const k of Object.keys(componentPatch)) {
      specs[k] = Object.assign({}, specs[k], componentPatch[k]);
      ['w', 'h', 'd', 'powerW'].forEach((f) => { specs[k][f] = num(specs[k][f], 0); });
      if (SELECTION_DRIVEN.indexOf(k) >= 0 && hasDims(componentPatch[k]))
        warnings.push({ level: 'info', code: 'DIMS_PINNED',
          msg: (specs[k].desc || k) + ': dimensions come from the selection ' +
               'table normally, so the library override pins them for every ' +
               'variant. Clear it in Components library to restore automatic sizing.' });
    }
    const spec = (t) => specs[t] || BLANK_COMPONENT;

    /* ── Sumber 24 V ────────────────────────────────────────────────────
       Kalau kamu memilih supply sendiri dari library, itulah yang dipakai —
       engine berhenti menambahkan satu secara otomatis, persis seperti terminal
       block di rail 4. Dulu supply tambahan tetap digambar dan masuk BOM tapi
       kapasitasnya diabaikan, sehingga utilization tidak pernah berubah.

       `psu` adalah slot otomatis itu sendiri, jadi menambahkannya berarti "satu
       unit lagi dengan model yang sama" — bukan pilihan manual. Yang mematikan
       pemilihan otomatis hanya katalog eksplisit (psu_5a/10a/20a/40a). */
    const psuExtras = c.extras.filter((e) =>
      e.type !== 'psu' && db[e.type] && num(db[e.type].psuA, 0) > 0);
    const psuManual = psuExtras.length > 0;
    /* ── thermal (needs a size; size needs a layout; so: layout first) ── */
    /* Kontaktor dulu, lalu overload — buildLayout memasangkan keduanya
       berurutan, jadi urutannya harus sejajar. */
    const contactorKeys = [], overloadKeys = [];
    for (const { st, qty } of starterPicks) {
      for (let i = 0; i < qty; i++) { contactorKeys.push(st.cKey); overloadKeys.push(st.oKey); }
    }
    const rail1 = ['mccb', 'spd'].concat(psuManual ? [] : ['psu'])
      .concat(contactorKeys, overloadKeys);
    /* An Ethernet switch only earns its place if there is something to network */
    const needsEth = hasPlc || c.hmi > 0;
    const rail2 = (hasPlc ? [plcKey] : [])
      .concat(fill(diExtra, expDiKey), fill(doExtra, expDoKey),
              fill(aiMods, expAiKey), fill(aoMods, expAoKey),
              needsEth ? ['eth'] : [], ['safety', 'mcb3'],
              fill(2 + c.hmi, 'mcb1'), fill(relays, 'irelay'));
    /* VFD dulu, lalu servo — masing-masing dengan model sesuai rating-nya */
    const rail3 = [];
    for (const kind of ['vfd', 'servo'])
      for (const p of drivePicks)
        if (p.kind === kind) for (let i = 0; i < p.qty; i++) rail3.push(p.d.key);

    /* Rail 4: terminal block yang dipakai, ditempatkan seperti komponen lain.
       Kosong secara default — isi dari Components library → “+ Panel → Rail 4”. */
    const rail4 = [];

    /* Components the user added by hand from the library, split by destination */
    const railOf = { 1: rail1, 2: rail2, 3: rail3, 4: rail4 };
    const doorExtras = [], sideExtrasL = [], sideExtrasR = [];
    for (const e of c.extras) {
      if (!specs[e.type]) {
        warnings.push({ level: 'error', code: 'UNKNOWN_COMPONENT',
          msg: 'Added component "' + e.type + '" is not in the library; ' +
               'it was skipped. Re-add it or remove it from this project.' });
        continue;
      }
      const target = e.place === 'door' ? doorExtras
        : e.place === 'left' ? sideExtrasL
        : e.place === 'right' ? sideExtrasR
        : railOf[e.rail];
      for (let i = 0; i < e.qty; i++) target.push(e.type);
    }

    /* Fan tidak lagi menyisihkan ruang di backplate, jadi layout → dims →
       thermal cukup satu lintasan; dulu perlu iterasi sampai jumlah fan
       konvergen dengan kolom cadangannya. */
    const layout = buildLayout({ rail1, rail2, rail3, rail4 }, {
      W, PAD, GAP, GAPV, DUCT, TSTRIP, spec, platePos: c.platePos,
      driveClearance: L.driveClearance,
    });
    const maxDepth = Math.max.apply(null,
      layout.items.map((i) => spec(i.type).d).concat([100]));
    const dims = {
      W,
      /* A chosen catalogue height is honoured as given; only automatic sizing
         rounds up to the next standard size. */
      H: c.cabH > 0 ? c.cabH
                    : pickAtLeast(STD_HEIGHTS.map((h) => ({ h })), layout.needH, 'h').h,
      D: pickAtLeast(STD_DEPTHS.map((d) => ({ d })), maxDepth + DEPTH_CLEARANCE, 'd').d,
      fixedH: c.cabH > 0,
    };
    if (!dims.fixedH && layout.needH > STD_HEIGHTS[STD_HEIGHTS.length - 1]) {
      dims.H = Math.ceil(layout.needH / 100) * 100;
      dims.nonStandardH = true;
    }
    /* Wall-mount enclosures are portrait by convention, so automatic sizing
       never returns a panel wider than it is tall — it grows the height to at
       least the width instead. Catalogue sizes are already portrait. */
    if (!dims.fixedH && dims.H < W) {
      dims.H = pickAtLeast(STD_HEIGHTS.map((h) => ({ h })), W, 'h').h;
      dims.portraitEnforced = true;
    }
    dims.freeStanding = dims.H > 800;

    const heat = heatLoad(layout, sched, dc, counts, A, spec);
    const th = thermal(heat.totalW, dims, c.ambientC, A);
    th.heat = heat;

    /* ── door & side layouts (need the final enclosure size) ─────────── */
    const door = buildDoorLayout(c, counts, spec, dims.W, dims.H, A, doorExtras);
    const side = buildSideLayout(c, th.fans, spec, dims, A, sideExtrasL, sideExtrasR);

    if (dims.nonStandardH)
      warnings.push({ level: 'warn', code: 'HEIGHT_NONSTD',
        msg: 'Required height ' + Math.round(layout.needH) +
             ' mm is above the standard range; verify the enclosure is available.' });
    /* A chosen size is respected, but it must be told when it cannot work. */
    if (dims.fixedH && layout.needH > dims.H)
      warnings.push({ level: 'error', code: 'PANEL_TOO_SMALL',
        msg: 'The backplate needs ' + Math.round(layout.needH) + ' mm of height but the ' +
             'selected panel is ' + dims.W + '×' + dims.H + ' mm. Choose a taller size, ' +
             'a wider one so rails pack better, or switch the size back to Auto.' });
    /* Drive yang dipindah manual bisa mendarat di rail biasa yang jaraknya cuma
       gapV — layout otomatis menjaga clearance, penempatan manual tidak. */
    const tightDrives = [];
    for (const it of layout.items) {
      if (spec(it.type).cat !== 'Drives') continue;
      const row = layout.rows.find((r) => r.list && Math.abs(r.railY - it.y) < 1);
      if (row && (row.clearance || 0) < L.driveClearance) tightDrives.push(it.tag);
    }
    if (tightDrives.length)
      warnings.push({ level: 'warn', code: 'DRIVE_CLEARANCE',
        msg: 'Drive ' + tightDrives.join(', ') + ' berada di rail dengan jarak ' +
             'kurang dari ' + L.driveClearance + ' mm. Heatsink butuh ruang napas ' +
             'atas–bawah; pindahkan kembali ke rail drive.' });
    for (const [what, list] of [['pintu', door.overlaps], ['panel sisi', side.overlaps]])
      if (list && list.length)
        warnings.push({ level: 'warn', code: 'DEVICE_OVERLAP',
          msg: 'Perangkat bertumpuk di ' + what + ': ' + list.slice(0, 6).join(', ') +
               (list.length > 6 ? ` (+${list.length - 6} lagi)` : '') +
               '. Dua lubang di titik yang sama tidak bisa dibor.' });
    if (layout.overlaps.length)
      warnings.push({ level: 'warn', code: 'PLATE_OVERLAP',
        msg: 'Komponen bertumpuk setelah digeser manual: ' +
             layout.overlaps.slice(0, 6).join(', ') +
             (layout.overlaps.length > 6 ? ` (+${layout.overlaps.length - 6} lagi)` : '') +
             '. Jarak 0 mm boleh, tapi tumpang tindih tidak bisa dirakit.' });
    if (side.tooShallow)
      warnings.push({ level: 'error', code: 'SIDE_TOO_SHALLOW',
        msg: 'Perangkat sisi selebar ' + side.widest + ' mm tidak muat di panel sedalam ' +
             dims.D + ' mm (butuh ≥ ' + (side.widest + side.margin * 2) +
             ' mm dengan margin). ' +
             'Pilih enclosure lebih dalam, atau pindahkan fan ke pintu secara manual.' });
    if (side.draggedOutside.length)
      warnings.push({ level: 'error', code: 'SIDE_DEVICE_OUTSIDE',
        msg: 'Perangkat sisi ' + side.draggedOutside.join(', ') + ' berada di luar ' +
             'panel. Tarik kembali ke dalam, atau reset posisi tab sisi.' });
    else if (!side.fits && side.items.length && !side.tooShallow)
      warnings.push({ level: 'error', code: 'SIDE_TOO_SMALL',
        msg: 'Perangkat sisi butuh tinggi ' + Math.round(side.neededH) + ' mm tapi ' +
             'panel hanya ' + dims.H + ' mm.' });
    if (door.draggedOutside.length)
      warnings.push({ level: 'error', code: 'DOOR_DEVICE_OUTSIDE',
        msg: 'Manually placed device(s) ' + door.draggedOutside.join(', ') +
             ' sit outside the door outline. Drag them back inside, or reset the ' +
             'front-cover layout to automatic.' });
    if (!door.fits)
      warnings.push({ level: 'error', code: 'DOOR_TOO_SMALL',
        msg: 'Front-cover devices need ' + Math.round(door.neededW) + '×' +
             Math.round(door.neededH) + ' mm but the door is ' + dims.W + '×' + dims.H +
             ' mm. Reduce door devices or choose a larger panel.' });
    if (layout.overflow)
      warnings.push({ level: 'error', code: 'TOO_WIDE',
        msg: 'A single component is wider than the usable backplate width. ' +
             'Increase the cabinet width.' });
    /* ── Kapasitas 24 V dari supply yang BENAR-BENAR terpasang ────────── */
    const psuUnits = layout.items
      .filter((i) => num(specs[i.type].psuA, 0) > 0)
      .map((i) => ({ tag: i.tag, pn: specs[i.type].pn,
                     a: i.type === 'psu' ? psuPick.ratedA : num(specs[i.type].psuA, 0) }));
    const psuCapacity = psuUnits.reduce((t, u) => t + u.a, 0);
    const psuDerated = psuCapacity * psuPick.derate;
    const psuUtil = psuDerated > 0 ? (dc.aTotal / psuDerated) * 100 : Infinity;
    /* Dua supply bisa berarti kapasitas ganda ATAU cadangan N+1 — engine tidak
       bisa tahu. Kapasitas dijumlahkan, tapi utilization saat satu unit mati
       ikut dilaporkan supaya pilihannya sadar, bukan diasumsikan. */
    const psuRedundantUtil = psuUnits.length > 1
      ? (dc.aTotal / ((psuCapacity - Math.max.apply(null, psuUnits.map((u) => u.a))) *
                      psuPick.derate)) * 100
      : null;

    if (!psuUnits.length)
      warnings.push({ level: 'error', code: 'PSU_MISSING',
        msg: 'Tidak ada sumber 24 V di panel, padahal beban kontrol ' +
             dc.aTotal.toFixed(1) + ' A. Tambahkan power supply dari Components library.' });
    else if (psuUtil > A.psuMaxUtil * 100 + 0.01)
      warnings.push({ level: psuUtil > 100 ? 'error' : 'warn', code: 'PSU_SHORT',
        msg: 'Beban 24 V ' + dc.aTotal.toFixed(1) + ' A terhadap kapasitas terpasang ' +
             psuCapacity + ' A = ' + Math.round(psuUtil) + '% ' +
             (psuUtil > 100 ? '— melebihi kapasitas.' : '— di atas batas ' +
              Math.round(A.psuMaxUtil * 100) + '%.') +
             (psuManual ? ' Tambah/besarkan supply yang kamu pilih.'
                        : ' Tidak ada supply di tabel yang cukup.') });
    if (th.method === 'cooling-unit')
      warnings.push({ level: 'warn', code: 'COOLING_UNIT', msg: th.note });

    /* ── terminals & wiring counts ─────────────────────────────────── */
    const powerTerms = 3 + 1 + (c.vfd + c.servo + dol) * 3 + c.motor;
    const controlTerms = c.di + c.do_ + (c.ai + c.ao) * 2;
    const spares = Math.ceil((powerTerms + controlTerms) * A.terminalSparePct);
    const termPoints = powerTerms + controlTerms + spares;

    const wiring = buildWiring({ cfg: c, counts, specs, mccb, driveMcb,
                                 controlMcb, starter, assumptions: A,
                                 fans: th.fans });

    /* ── BOM ───────────────────────────────────────────────────────── */
    /* Terminal yang benar-benar dipasang di rail 4 (bukan perkiraan) */
    const placedTerminals = layout.items.filter((i) => {
      const d = specs[i.type];
      return d && d.cat === 'Terminals' && !/end clamp|partition/i.test(d.desc || '');
    }).length;
    const terminalsItemised = rail4.length > 0;
    if (terminalsItemised && placedTerminals < termPoints)
      warnings.push({ level: 'warn', code: 'TERMINALS_SHORT',
        msg: 'Terminal terpasang ' + placedTerminals + ' buah, sedangkan desain ' +
             'butuh ' + termPoints + ' titik (termasuk ' + spares + ' spare). ' +
             'Tambahkan sisanya di RAIL 4 dari Components library.' });

    const bom = buildBom({
      layout, door, side, dims, specs, counts, cfg: c, termPoints, powerTerms,
      controlTerms, spares, wiring, thermal: th, assumptions: A,
      terminalsItemised,
    });

    return {
      cfg: c, assumptions: A, warnings,
      /* Resolved component specs for THIS design. Selection changes physical
         size (a 10 A supply is 60 mm, a 20 A is 97 mm), so anything drawing or
         measuring the layout must read these, not COMPONENT_DB. */
      specs,
      /* layout */
      items: layout.items, rows: layout.rows, W: dims.W, H: dims.H, D: dims.D,
      dims, needH: layout.needH, overflow: layout.overflow,
      railRows: layout.railRows, manualPlate: layout.manualPlate,
      overlaps: layout.overlaps,
      /* front cover & panel sisi */
      door, side, hasPlc, cpu, plcKey,
      railLengthMm: layout.railLengthMm, railFreeMm: layout.railFreeMm,
      ductLengthMm: layout.ductLengthMm,
      /* electrical */
      schedule: sched.rows, dol, diExtra, doExtra, aiMods, aoMods, relays,
      dcLoad: dc.wTotal, dcInternalW: dc.wInternal, dcExternalW: dc.wExternal,
      dcAmps: dc.aTotal, dcDetail: dc,
      totalW: totalPIn, totalVA: totalS, systemPf,
      flcA, startA, peakA: flcA,
      /* util sekarang mengikuti kapasitas TERPASANG, bukan satu unit hasil
         pemilihan otomatis — menambah supply benar-benar menurunkannya. */
      psu: psuPick, psuA: psuCapacity, util: psuUtil,
      psuUnits, psuCapacity, psuManual, psuRedundantUtil,
      mccb, driveMcb, controlMcb, starter, driveA,
      /* thermal */
      heat: heat.totalW, heatDetail: heat, thermal: th,
      temp: Math.round(th.insideC), fans: th.fans,
      /* schedules */
      termPoints, powerTerms, controlTerms, spares,
      wiring, wires: wiring.length, bom,
      totalQty: bom.reduce((t, b) => t + (b.countable ? b.qty : 0), 0),
    };
  }

  /* ══════════ LAYOUT BUILDER ══════════ */
  function buildLayout(rails, o) {
    const { W, PAD, GAP, GAPV, DUCT, TSTRIP, spec } = o;
    /* Model kontaktor/overload berbeda per rating motor, jadi jenisnya dikenali
       lewat baseKey — bukan lewat nama key yang harfiah. */
    const isBase = (t, base) => t === base || (spec(t) && spec(t).baseKey === base);
    const overloadFor = (list, kIdx) => {
      const n = list.slice(0, kIdx + 1).filter((t) => isBase(t, 'contactor')).length;
      const os = list.filter((t) => isBase(t, 'overload'));
      return os[n - 1] || os[0] || 'overload';
    };
    /* Exhaust fan dan intake filter kini digambar di panel SISI (left/right
       side view), jadi backplate tidak lagi menyisihkan kolom untuk fan. */
    const usableW = W - PAD * 2;

    const rows = [];
    let y = PAD, overflow = false, railLengthMm = 0, railUsedMm = 0;

    const emitRailGroup = (list, title) => {
      const chunks = packRows(list, usableW, GAP, spec);
      chunks.forEach((chunk, i) => {
        if (!chunk.length) return;
        const h = Math.max(60, ...chunk.map((t) => spec(t).h));
        const kIdx = chunk.findIndex((t) => isBase(t, 'contactor'));
        const stackH = kIdx >= 0
          ? spec(chunk[kIdx]).h + 4 + spec(overloadFor(chunk, kIdx)).h : 0;
        const rowH = Math.max(h, stackH);
        const used = chunk.reduce((t, x) => t + spec(x).w + GAP, 0) - GAP;
        if (chunk.some((t) => spec(t).w > usableW)) overflow = true;
        /* Rail berisi drive butuh ruang napas untuk heatsink-nya. */
        const hasDrive = chunk.some((t) => spec(t).cat === 'Drives');
        const clear = hasDrive ? Math.max(GAPV, o.driveClearance || 0) : GAPV;
        if (hasDrive) y += clear - GAPV;            /* ruang di ATAS rail drive */
        /* VFD dan servo DIBAUT ke backplate, bukan diklip ke DIN rail — jadi
           baris yang seluruhnya berisi komponen mount:'plate' tidak menggambar
           rail dan tidak ikut menghitung panjang rail. */
        const needsRail = chunk.some((t) => spec(t).mount !== 'plate');
        if (needsRail) {                            /* hanya baris ber-rail yang dibeli */
          railLengthMm += W - PAD * 2;
          railUsedMm += Math.max(0, used);
        }
        rows.push({ list: chunk, h: rowH, railY: y + rowH / 2, clearance: clear,
                    needsRail,
                    name: (needsRail ? title : title.replace(/^DIN RAIL \d+ · /, 'BACKPLATE · ')) +
                          (chunks.length > 1 ? ' (' + (i + 1) + '/' +
                          chunks.length + ')' : '') });
        y += rowH + clear;                          /* dan di BAWAHnya */
      });
    };
    const emitBand = (kind, h, label) => {
      rows.push({ kind, y0: y, h, label });
      y += h + GAPV;
    };

    emitRailGroup(rails.rail1, 'DIN RAIL 1 · INCOMING / POWER');
    emitBand('duct', DUCT, 'WIRE DUCT ' + DUCT + '×60');
    emitRailGroup(rails.rail2, 'DIN RAIL 2 · CONTROL');
    emitBand('duct', DUCT, 'WIRE DUCT ' + DUCT + '×60');
    if (rails.rail3.length) {
      emitRailGroup(rails.rail3, 'DIN RAIL 3 · DRIVES');
      emitBand('duct', DUCT, 'WIRE DUCT ' + DUCT + '×60');
    }
    /* Kalau terminal block sudah dipilih dari library, gambarkan sebagai rail
       sungguhan; kalau belum, tetap tampilkan band ringkas seperti sebelumnya. */
    if (rails.rail4 && rails.rail4.length)
      emitRailGroup(rails.rail4, 'DIN RAIL 4 · TERMINAL BLOCKS');
    else
      emitBand('tstrip', TSTRIP, 'TERMINAL BLOCKS X1–X4');

    const needH = y - GAPV + PAD;

    /* place components */
    let items = [];
    for (const row of rows) {
      if (!row.list) continue;
      let x = PAD;
      for (const t of row.list) {
        const d = spec(t);
        if (isBase(t, 'overload')) {
          /* overload hangs under its own contactor, same x */
          const hosts = items.filter((i) => isBase(i.type, 'contactor'));
          const mine = items.filter((i) => isBase(i.type, 'overload')).length;
          if (hosts[mine]) {
            items.push({ type: t, x: hosts[mine].x,
              y: hosts[mine].y + (spec(hosts[mine].type).h + d.h) / 2 + 4 });
          }
          continue;
        }
        const yPos = isBase(t, 'contactor')
          ? row.railY - (spec(overloadFor(row.list, row.list.indexOf(t))).h + 4) / 2
          : row.railY;
        items.push({ type: t, x: x + d.w / 2, y: yPos });
        x += d.w + GAP;
      }
    }
    const ductLengthMm = rows.filter((r) => r.kind === 'duct')
      .reduce((t) => t + (W - PAD * 2), 0);

    /* tag every placed component so drawing, schedule and BOM agree */
    items = designate(items, null, spec);

    /* ── penempatan manual di backplate ──────────────────────────────────
       X bebas (UI membulatkan ke langkah 2 mm, jadi jarak antar komponen boleh
       0), sedangkan vertikal SELALU snap ke garis rail: `row` memilih rail ke
       berapa. Komponen tidak akan pernah menggantung di antara dua rail. */
    const railRows = rows.map((r, i) => (r.list ? i : -1)).filter((i) => i >= 0);
    const manualPlate = [];
    if (o.platePos) {
      items = items.map((it) => {
        const p = o.platePos[it.id];
        if (!p) return it;
        const next = Object.assign({}, it, { manual: true });
        if (Number.isFinite(p.x)) next.x = p.x;
        if (Number.isInteger(p.row) && railRows.indexOf(p.row) >= 0) {
          const row = rows[p.row];
          next.y = it.type === 'contactor'
            ? row.railY - (spec('overload').h + 4) / 2 : row.railY;
          next.row = p.row;
        }
        manualPlate.push(it.id);
        return next;
      });
      /* Overload mengikuti kontaktornya. Pasangannya dicocokkan lewat URUTAN
         (overload ke-n milik kontaktor ke-n), bukan lewat nama key — model
         kontaktor kini berbeda-beda mengikuti rating motornya. */
      const hosts = items.filter((i) => isBase(i.type, 'contactor'));
      let n = 0;
      items = items.map((it) => {
        if (!isBase(it.type, 'overload')) return it;
        const host = hosts[n++];
        if (!host || !host.manual) return it;
        return Object.assign({}, it, { x: host.x,
          y: host.y + (spec(host.type).h + spec(it.type).h) / 2 + 4 });
      });
    }
    /* Jarak 0 diizinkan, tapi tumpang tindih tetap dilaporkan. */
    const overlaps = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.type === 'fan' || b.type === 'fan') continue;
        const da = spec(a.type), dbb = spec(b.type);
        const gapX = Math.abs(a.x - b.x) - (da.w + dbb.w) / 2;
        const gapY = Math.abs(a.y - b.y) - (da.h + dbb.h) / 2;
        if (gapX < -0.51 && gapY < -0.51) overlaps.push(a.tag + '/' + b.tag);
      }
    }

    return { rows, items, needH, overflow, usableW, railRows,
             manualPlate, overlaps,
             railLengthMm, railFreeMm: Math.max(0, railLengthMm - railUsedMm),
             ductLengthMm };
  }

  /* ══════════ FRONT COVER (DOOR) LAYOUT ══════════
     Operator devices on the door. Zones run top to bottom; the E-stop gets a
     reserved top-right block because IEC 60204-1 §10.7 wants it unobstructed
     and immediately reachable, so nothing else may crowd it. */
  function buildDoorLayout(c, counts, spec, W, H, A, doorExtras) {
    const D = A.door, M = D.margin;
    const items = [], zones = [];
    const est = spec('estop');

    /* reserved E-stop block, top-right */
    items.push({ type: 'estop', x: W - M - est.w / 2, y: M + est.h / 2 });
    const estopReserve = est.w + D.gap * 2;
    let y = M;

    const emit = (list, title, usableW) => {
      if (!list.length) return;
      const chunks = packRows(list, usableW, D.gap, spec);
      chunks.forEach((chunk) => {
        if (!chunk.length) return;
        const rowH = Math.max.apply(null, chunk.map((t) => spec(t).h));
        let x = M;
        for (const t of chunk) {
          const d = spec(t);
          items.push({ type: t, x: x + d.w / 2, y: y + rowH / 2 });
          x += d.w + D.gap;
        }
        zones.push({ y0: y, h: rowH, label: title, count: chunk.length });
        y += rowH + D.rowGap;
      });
    };

    /* HMI sits beside the E-stop block, so its usable width is reduced */
    emit(fill(c.hmi, 'hmi'), 'HMI', W - M * 2 - estopReserve);
    /* everything below must clear the E-stop block */
    y = Math.max(y, M + est.h + D.rowGap);

    emit(['disconnect', 'sel_auto', 'pb_start', 'pb_stop', 'pb_reset'],
         'CONTROLS', W - M * 2);
    /* one run lamp per DOL starter (hard-wired indication) plus a system run */
    emit(['lamp_pwr'].concat(fill(1 + counts.dol, 'lamp_run'), ['lamp_flt']),
         'INDICATION', W - M * 2);
    /* library components the user sent to the front cover */
    emit(doorExtras || [], 'ADDED FROM LIBRARY', W - M * 2);

    /* Identify before overriding — manual positions are keyed on the id. */
    let placed = designate(items, DOOR_TAG, spec);

    /* Manual placement wins over the generated position. Only the devices you
       actually moved are pinned; the rest keep flowing automatically. */
    const manual = [];
    placed = placed.map((it) => {
      const p = c.doorPos && c.doorPos[it.id];
      if (!p) return it;
      manual.push(it.id);
      return Object.assign({}, it, { x: p.x, y: p.y, manual: true });
    });

    /* Extent is measured from where things ACTUALLY are, so a device dragged
       off the door still reports as not fitting. */
    const ext = placed.reduce((a, it) => {
      const d = spec(it.type);
      return { w: Math.max(a.w, it.x + d.w / 2), h: Math.max(a.h, it.y + d.h / 2) };
    }, { w: 0, h: 0 });
    const isOutside = (it) => {
      const d = spec(it.type);
      return it.x - d.w / 2 < 0 || it.x + d.w / 2 > W ||
             it.y - d.h / 2 < 0 || it.y + d.h / 2 > H;
    };
    const outside = placed.filter(isOutside).map((it) => it.tag);
    /* Separate the two causes: a device you dragged off the door needs "drag it
       back", a device the generator could not fit needs a bigger panel. */
    const draggedOutside = placed.filter((it) => it.manual && isOutside(it))
      .map((it) => it.tag);

    /* Tumpang tindih di pintu: dicegah saat menggeser, tapi masih bisa masuk
       lewat proyek lama atau komponen yang dimensinya diperbesar di library. */
    const overlaps = [];
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const da = spec(a.type), db = spec(b.type);
        if (Math.abs(a.x - b.x) < (da.w + db.w) / 2 - 0.51 &&
            Math.abs(a.y - b.y) < (da.h + db.h) / 2 - 0.51)
          overlaps.push(a.tag + '/' + b.tag);
      }

    return { items: placed, zones, margin: M, manual, outside, draggedOutside,
             overlaps,
             neededH: Math.max(ext.h + M, M + est.h + M),
             neededW: ext.w + M,
             fits: ext.h <= H && ext.w <= W && !outside.length };
  }

  /* ══════════ SIDE PANELS (kiri / kanan) ══════════
     Jalur udara menyilang: intake berfilter RENDAH di sisi kiri, exhaust fan
     TINGGI di sisi kanan — udara masuk bawah-kiri, menyapu drive, keluar
     atas-kanan. Panel sisi dilihat dari luar: lebar gambar = kedalaman
     enclosure (D), tinggi = tinggi enclosure (H). */
  function buildSideLayout(c, fans, spec, dims, A, extrasL, extrasR) {
    const M = 40, GAPV = 20, D = dims.D, H = dims.H;
    const rightList = fill(fans, 'fan').concat(extrasR || []);
    const leftList = fill(fans, 'filter_out').concat(extrasL || []);

    const raw = [];
    let y = M;                                   /* kanan: susun dari atas */
    for (const t of rightList) {
      const d = spec(t);
      raw.push({ type: t, side: 'right', x: D / 2, y: y + d.h / 2 });
      y += d.h + GAPV;
    }
    y = H - M;                                   /* kiri: susun dari bawah */
    for (const t of leftList) {
      const d = spec(t);
      raw.push({ type: t, side: 'left', x: D / 2, y: y - d.h / 2 });
      y -= d.h + GAPV;
    }

    /* satu designate untuk kedua sisi supaya tag unik: E1.. fan, V1.. filter */
    let items = designate(raw);
    const manual = [];
    items = items.map((it) => {
      const p = c.sidePos && c.sidePos[it.id];
      if (!p) return it;
      manual.push(it.id);
      const next = Object.assign({}, it, { manual: true, x: p.x, y: p.y });
      if (p.side) next.side = p.side;            /* boleh dipindah antar sisi */
      return next;
    });

    const isOutside = (it) => {
      const d = spec(it.type);
      return it.x - d.w / 2 < 0 || it.x + d.w / 2 > D ||
             it.y - d.h / 2 < 0 || it.y + d.h / 2 > H;
    };
    const outside = items.filter(isOutside).map((it) => it.tag);
    const draggedOutside = items.filter((it) => it.manual && isOutside(it))
      .map((it) => it.tag);

    const stackNeed = (list) => list.length
      ? M * 2 + list.reduce((t, x) => t + spec(x).h, 0) + GAPV * (list.length - 1)
      : 0;
    const widest = items.reduce((mx, it) => Math.max(mx, spec(it.type).w), 0);
    const neededH = Math.max(stackNeed(rightList), stackNeed(leftList));

    /* Sama seperti pintu — hanya perangkat di SISI yang sama yang bisa bentrok. */
    const overlaps = [];
    for (const side of ['left', 'right']) {
      const g = items.filter((i) => i.side === side);
      for (let i = 0; i < g.length; i++)
        for (let j = i + 1; j < g.length; j++) {
          const a = g[i], b = g[j], da = spec(a.type), db = spec(b.type);
          if (Math.abs(a.x - b.x) < (da.w + db.w) / 2 - 0.51 &&
              Math.abs(a.y - b.y) < (da.h + db.h) / 2 - 0.51)
            overlaps.push(a.tag + '/' + b.tag);
        }
    }

    return {
      items, overlaps,
      left: items.filter((i) => i.side === 'left'),
      right: items.filter((i) => i.side === 'right'),
      margin: M, manual, outside, draggedOutside, neededH, widest,
      /* fan lebih lebar dari kedalaman panel = tidak bisa dipasang di sisi */
      tooShallow: widest > D - M * 2 && items.length > 0,
      fits: neededH <= H && !outside.length && widest <= D - M * 2,
    };
  }

  /* ══════════ HEAT LOAD ══════════ */
  function heatLoad(layout, sched, dc, counts, A, spec) {
    const lines = [];
    const push = (name, w) => { if (w > 0) lines.push({ name, w: Math.round(w * 10) / 10 }); };

    for (const r of sched.rows) {
      if (/VFD/.test(r.name))   push('VFD losses',   r.shaftW * r.qty * (1 - A.eff.vfdDrive));
      if (/Servo/.test(r.name)) push('Servo losses', r.shaftW * r.qty * (1 - A.eff.servoDrive));
    }
    /* PSU conversion loss, on the whole 24 V throughput */
    push('PSU conversion loss', dc.wTotal * (1 / A.eff.psu - 1));
    /* 24 V gear inside the box turns all of its input into heat */
    push('Control gear (24 V, internal)', dc.wInternal);
    /* switchgear I²R — dihitung lewat baseKey, karena model kontaktor/overload
       berbeda per rating motor dan key-nya disintesis (contactor_LC1D18BD). */
    const n = (t) => layout.items.filter((i) => {
      const d = spec(i.type);
      return i.type === t || (d && d.baseKey === t);
    }).length;
    push('Contactors', n('contactor') * A.heatPerContactor);
    push('Overload relays', n('overload') * A.heatPerOverload);
    push('MCCB', n('mccb') * 3 * A.heatPerMccbPole);
    push('MCBs', (n('mcb3') * 3 + n('mcb1')) * A.heatPerMcbPole);

    const totalW = Math.round(lines.reduce((t, l) => t + l.w, 0));
    return { lines, totalW,
             note: 'Field devices (' + Math.round(dc.wExternal) + ' W) dissipate ' +
                   'outside the enclosure and are excluded.' };
  }

  /* ══════════ WIRING LIST ══════════ */
  function buildWiring(o) {
    const c = o.cfg, k = o.counts, A = o.assumptions, C = WIRE_COLOUR;
    const rows = [];
    let n = 1;
    const add = (from, to, size, colour, note) => rows.push({
      no: 'W' + String(n++).padStart(3, '0'), from, to, size, colour, note,
    });

    /* incoming & distribution */
    add('Incoming L1/L2/L3', o.mccb.pn + ' 1/3/5', '6 mm²', C.power, 'Supply in');
    add('Incoming PE', 'PE bar', '6 mm² G/Y', C.pe, 'Protective earth');
    add(o.mccb.pn + ' 2/4/6', 'SPD L1/L2/L3', '2.5 mm²', C.power, 'Surge protection');
    add('SPD PE', 'PE bar', '6 mm² G/Y', C.pe, 'Surge discharge path');
    add(o.mccb.pn + ' 2/4/6', o.driveMcb.pn + ' 1/3/5', '4 mm²', C.power, 'Drives feeder');
    add(o.mccb.pn + ' 2/L1', o.controlMcb.pn + ' 1', '1.5 mm²', C.power, 'Control feeder');
    add(o.controlMcb.pn + ' 2', 'PSU L', '1.5 mm²', C.power, 'PSU supply');
    add('Incoming N', 'PSU N', '1.5 mm²', C.neutral, 'PSU neutral');

    /* drives */
    for (let i = 1; i <= c.vfd; i++)
      add(o.driveMcb.pn + ' 2/4/6', 'VFD' + i + ' R/S/T', '2.5 mm²', C.power, 'Drive supply');
    for (let i = 1; i <= c.vfd; i++) {
      add('VFD' + i + ' U/V/W', 'X2:' + (i * 3 - 2) + '–' + (i * 3) + ' → Motor M' + i,
          '2.5 mm² shielded', C.power, 'Motor cable, shield both ends');
      add('VFD' + i + ' PE', 'PE bar', '2.5 mm² G/Y', C.pe, 'Drive earth');
    }
    for (let i = 1; i <= c.servo; i++) {
      add(o.driveMcb.pn + ' 2/4/6', 'Servo' + i + ' L1/L2/L3', '2.5 mm²', C.power, 'Servo supply');
      add('Servo' + i + ' U/V/W', 'Servo motor SM' + i, 'Servo motor cable', C.power, 'Servo motor');
      add('Servo' + i + ' PE', 'PE bar', '2.5 mm² G/Y', C.pe, 'Servo earth');
      add('Servo' + i + ' CN3 encoder', 'SM' + i + ' encoder', 'Encoder cable', C.dcControl, 'Feedback');
    }

    /* DOL starters — coil circuits were missing entirely before */
    for (let i = 1; i <= k.dol; i++) {
      const m = c.vfd + c.servo + i;
      add(o.driveMcb.pn + ' 2/4/6', 'K' + i + ' 1/3/5', '2.5 mm²', C.power, 'DOL feeder');
      add('K' + i + ' 2/4/6', 'F' + i + ' overload 1/3/5', '2.5 mm²', C.power, 'To overload');
      add('F' + i + ' 2/4/6', 'X2 → Motor M' + m, '2.5 mm²', C.power, 'DOL motor');
      add('Motor M' + m + ' PE', 'PE bar', '2.5 mm² G/Y', C.pe, 'Motor earth');
      /* With no CPU the starter is commanded by the door pushbuttons through a
         latching contact instead of a PLC output. */
      add(k.hasPlc ? 'PLC Y' + (c.valve + i - 1) : 'S3 START 13/14 (latched by K' + i + ' 13/14)',
          'K' + i + ' A1 (coil +)', '0.75 mm²', C.dcControl, 'Contactor coil');
      add('K' + i + ' A2', 'Safety relay 14 → 0 V', '0.75 mm²', C.dcControl, 'Coil return via safety');
      add('F' + i + ' 95/96',
          k.hasPlc ? 'PLC X' + (c.di + i - 1) : 'H3 FAULT lamp + K' + i + ' coil interrupt',
          '0.5 mm²', C.dcControl, 'Overload trip feedback');
    }

    /* control power */
    add('PSU +24V', 'X0:1 → 24 V distribution', '2.5 mm²', C.dcControl, 'Control power');
    add('PSU 0V', 'X0:2 → 0 V distribution', '2.5 mm²', C.dcControl, 'Control common');
    add('PSU PE', 'PE bar', '2.5 mm² G/Y', C.pe, 'PSU earth');
    if (k.hasPlc)
      add('X0:1 / X0:2', 'PLC 24 V / 0 V', '1.0 mm²', C.dcControl, 'PLC supply');
    if (k.hasPlc || c.hmi > 0)
      add('X0:1 / X0:2', 'Ethernet switch 24 V / 0 V', '0.75 mm²', C.dcControl, 'Switch supply');
    add('X0:1 / X0:2', 'Safety relay A1 / A2', '0.75 mm²', C.dcControl, 'Safety supply');

    /* safety chain — outputs now actually go somewhere */
    add('E-stop NC ch.1', 'Safety relay S11/S12', '0.75 mm²', C.dcControl, 'E-stop channel 1');
    add('E-stop NC ch.2', 'Safety relay S21/S22', '0.75 mm²', C.dcControl, 'E-stop channel 2');
    add('Safety relay 13/14', 'Contactor coil return path', '0.75 mm²', C.dcControl,
        'Stop cat. 0 — drops all starters');
    for (let i = 1; i <= c.vfd; i++)
      add('Safety relay 23/24', 'VFD' + i + ' STO / MRS', '0.75 mm²', C.dcControl, 'Safe torque off');
    for (let i = 1; i <= c.servo; i++)
      add('Safety relay 33/34', 'Servo' + i + ' CN8 STO', '0.75 mm²', C.dcControl, 'Safe torque off');
    add('Safety relay 41/42', 'H3 FAULT lamp', '0.75 mm²', C.dcControl, 'Safety status');

    /* ── front cover / door devices ──────────────────────────────────── */
    add('X0:1', 'S0 disconnect handle aux', '1.5 mm²', C.power, 'Main switch position');
    add('E-stop S1 terminals', 'X5:1/X5:2 → door harness', '0.75 mm²', C.dcControl, 'E-stop to door');
    add('S2 AUTO/OFF/MAN common', 'X0:1 (+24 V)', '0.75 mm²', C.dcControl, 'Selector supply');
    add('S2 AUTO 13/14', k.hasPlc ? 'PLC X (auto request)' : 'K1 coil path (auto)',
        '0.75 mm²', C.dcControl, 'Selector AUTO');
    add('S2 MAN 23/24', k.hasPlc ? 'PLC X (manual request)' : 'K1 coil path (manual)',
        '0.75 mm²', C.dcControl, 'Selector MANUAL');
    add('S3 START 13/14', k.hasPlc ? 'PLC X (start)' : 'Contactor coil latch',
        '0.75 mm²', C.dcControl, 'Start pushbutton');
    add('S4 STOP 11/12', k.hasPlc ? 'PLC X (stop)' : 'Contactor coil series',
        '0.75 mm²', C.dcControl, 'Stop pushbutton, NC');
    add('S5 RESET 13/14', 'Safety relay reset input', '0.75 mm²', C.dcControl, 'Safety reset');
    add('X0:1', 'H1 POWER lamp', '0.75 mm²', C.dcControl, 'Power-on indication');
    add(k.hasPlc ? 'PLC Y (system run)' : 'K1 13/14 aux', 'H2 RUN lamp',
        '0.75 mm²', C.dcControl, 'Run indication');
    for (let i = 1; i <= k.dol; i++)
      add('K' + i + ' 23/24 aux', 'H2.' + i + ' RUN lamp M' + (c.vfd + c.servo + i),
          '0.75 mm²', C.dcControl, 'Starter run indication');
    add('Door devices 0 V', 'X0:2', '0.75 mm²', C.dcControl, 'Door common');

    /* field I/O — no truncation. Without a CPU everything still lands on the
       terminal strip so the machine wiring is unchanged. */
    for (let i = 1; i <= c.di; i++)
      add('X1:' + i, k.hasPlc ? 'PLC X' + (i - 1) : 'X1:' + i + ' (spare, no CPU)',
          '0.5 mm²', C.dcControl, 'Digital input');
    for (let i = 1; i <= c.do_; i++) {
      const isValve = i <= c.valve;
      add(k.hasPlc ? 'PLC Y' + (i - 1) : 'X0:1 via control logic',
          isValve ? 'KA' + i + ' A1 (relay coil)' : 'X3:' + i,
          '0.5 mm²', C.dcControl, isValve ? 'Output via interface relay' : 'Digital output');
      if (isValve)
        add('KA' + i + ' 11/14', 'X3:' + i + ' → SV' + i, '0.75 mm²', C.dcControl, 'Solenoid valve');
    }
    for (let i = 1; i <= c.ai; i++)
      add('X4:' + (i * 2 - 1) + '/' + (i * 2),
          k.hasPlc ? 'FX5-4AD#' + Math.ceil(i / 4) + ' CH' + (((i - 1) % 4) + 1)
                   : 'X4 (spare, no CPU)',
          '0.5 mm² shielded', C.dcControl, 'Analog input');
    for (let i = 1; i <= c.ao; i++)
      add(k.hasPlc ? 'FX5-4DA#' + Math.ceil(i / 4) + ' CH' + (((i - 1) % 4) + 1)
                   : 'X4 (spare, no CPU)',
          'X4:' + (c.ai * 2 + i * 2 - 1) + '/' + (c.ai * 2 + i * 2),
          '0.5 mm² shielded', C.dcControl, 'Analog output');

    /* network & enclosure bonding */
    if (k.hasPlc)
      add('Ethernet switch P1', 'PLC Ethernet', 'Cat5e S/FTP', C.dcControl, 'Ethernet');
    for (let i = 1; i <= c.hmi; i++)
      add('Ethernet switch P' + (i + 1), 'HMI' + i, 'Cat5e S/FTP', C.dcControl, 'Ethernet');
    for (let i = 1; i <= c.hmi; i++)
      add('X0:1 / X0:2', 'HMI' + i + ' 24 V / 0 V', '0.75 mm²', C.dcControl, 'HMI supply');
    add('Enclosure door', 'PE bar', '4 mm² G/Y flexible', C.pe, 'Door bonding, IEC 60204-1');
    add('Backplate', 'PE bar', '6 mm² G/Y', C.pe, 'Backplate bonding');
    /* tag E1.. sama dengan yang tertera di gambar panel sisi kanan */
    for (let i = 1; i <= (o.fans || 0); i++)
      add('X0:1 / X0:2', 'Exhaust fan E' + i + ' (right side)', '0.75 mm²',
          C.dcControl, 'Cooling');

    return rows;
  }

  /* ══════════ BOM ══════════
     No stock or lead-time fields: this tool has no supplier feed, and inventing
     them (as the prototype did) puts fiction in front of purchasing. `source`
     records how each quantity was arrived at instead. */
  function buildBom(o) {
    const { layout, dims, specs, cfg, termPoints, powerTerms, controlTerms,
            spares, wiring, thermal: th } = o;
    const out = [];
    /* A zero-quantity line is noise on a purchase order — drop it rather than
       print "0 pcs". Callers therefore never have to filter. */
    const line = (pn, desc, qty, unit, vendor, cat, source, opts) => {
      if (!(qty > 0)) return;
      out.push(Object.assign({
        pn, desc, qty, unit: unit || 'pcs', vendor, cat, source,
        unitPrice: null, subtotal: null, countable: true,
      }, opts || {}));
    };

    /* enclosure — generic descriptor, not a fabricated vendor order number */
    line('ENC-' + dims.W + 'x' + dims.H + 'x' + dims.D + '-IP55',
      'Enclosure ' + dims.W + '×' + dims.H + '×' + dims.D + ' mm, IP55, ' +
      (dims.freeStanding ? 'free standing' : 'wall mount') +
      ', mild steel RAL 7035', 1, 'pcs', 'to be specified', 'Enclosure',
      'calculated', { generic: true });
    line('MP-BACKPLATE-' + dims.W + 'x' + dims.H,
      'Mounting backplate, galvanised', 1, 'pcs', 'to be specified',
      'Enclosure', 'calculated', { generic: true });
    line('MP-GLANDPLATE', 'Bottom gland plate with grommets', 1, 'pcs',
      'to be specified', 'Enclosure', 'calculated', { generic: true });

    /* active components, from what the layout actually placed — backplate and
       front cover both, so door devices can no longer be missed */
    const agg = {};
    for (const it of layout.items.concat(o.door ? o.door.items : [],
                                         o.side ? o.side.items : []))
      agg[it.type] = (agg[it.type] || 0) + 1;
    for (const t of Object.keys(agg)) {
      const d = specs[t];
      line(d.pn, d.desc, agg[t], 'pcs', d.vendor, d.cat, 'calculated',
        { dimsVerified: d.dimsVerified, door: d.mount === 'door',
          generic: !!d.generic });
    }
    /* legend engraving / labels for the operator devices */
    const doorCount = o.door ? o.door.items.length : 0;
    if (doorCount)
      line('LEGEND-PLATE', 'Legend plate / engraved label for door device',
        doorCount, 'pcs', 'to be specified', 'Consumables', 'estimated',
        { generic: true });
    /* Exhaust fan dan intake filter sudah masuk lewat agregasi panel sisi
       di atas (`side.items`) — jangan tambahkan lagi di sini. */
    if (th.method === 'cooling-unit')
      line('COOLING-UNIT-TBD',
        'Cooling unit / air-air heat exchanger — ' + Math.round(th.requiredM3h) +
        ' m³/h class, select from vendor range', 1, 'pcs', 'to be specified',
        'Cooling', 'calculated', { generic: true });

    /* ── consumables: absent from the prototype BOM entirely ──
       Kalau terminal block sudah dipilih sendiri di RAIL 4, jangan tambahkan
       lagi perkiraan otomatis — nanti double-count untuk barang yang sama.
       Part number diambil dari database supaya tidak ada dua ejaan. */
    const D = specs;
    if (!o.terminalsItemised) {
      line(D.tb_6.pn, 'Feed-through terminal 6 mm² (power)', powerTerms, 'pcs',
        D.tb_6.vendor, 'Terminals', 'calculated');
      line(D.tb_2_5.pn, 'Feed-through terminal 2.5 mm² (control)', controlTerms,
        'pcs', D.tb_2_5.vendor, 'Terminals', 'calculated');
      line(D.tb_2_5.pn + ' (spare)', 'Terminal 2.5 mm², installed spare (' +
        Math.round(o.assumptions.terminalSparePct * 100) + '%)', spares, 'pcs',
        D.tb_2_5.vendor, 'Terminals', 'calculated');
      line(D.tb_endclamp.pn, 'End clamp for terminal strips', 8, 'pcs',
        D.tb_endclamp.vendor, 'Terminals', 'estimated');
      line('D-UT 2,5', 'End cover for terminal strips', 4, 'pcs',
        'Phoenix Contact', 'Terminals', 'estimated');
    }
    line('PE-BAR-12', 'PE busbar, 12-way', 1, 'pcs', 'to be specified',
      'Terminals', 'calculated', { generic: true });

    line('DIN-TS35-2M', 'DIN rail TS35 ×7.5, 2 m length',
      Math.ceil(layout.railLengthMm / 2000), 'pcs', 'to be specified',
      'Mechanical', 'calculated', { generic: true });
    /* Komponen mount:'plate' (VFD, servo) dibaut langsung ke backplate, jadi
       butuh pengencang — bukan potongan DIN rail. */
    const plateMounted = layout.items.filter((i) => specs[i.type].mount === 'plate').length;
    if (plateMounted)
      line('FASTENER-M6', 'Baut M6 + ring + mur kandang untuk komponen backplate',
        plateMounted * 4, 'set', 'to be specified', 'Mechanical', 'estimated',
        { generic: true, note: '4 titik pengikat per komponen' });
    line('DUCT-45x60-2M', 'Slotted wire duct 45×60 mm with cover, 2 m length',
      Math.ceil(layout.ductLengthMm / 2000), 'pcs', 'to be specified',
      'Mechanical', 'calculated', { generic: true });

    /* cable glands: one per field cable group leaving the enclosure */
    const glands = cfg.motor + Math.ceil(cfg.di / 8) + Math.ceil(cfg.do_ / 8) +
                   cfg.hmi + (cfg.ai + cfg.ao > 0 ? 1 : 0) + 2;
    line('GLAND-M20', 'Cable gland M20 with locknut', glands, 'pcs',
      'to be specified', 'Mechanical', 'estimated', { generic: true });

    /* wire-end treatment scales with the wiring list, both ends */
    line('FERRULE-ASSORTED', 'Wire ferrules, insulated, assorted 0.5–6 mm²',
      wiring.length * 2, 'pcs', 'to be specified', 'Consumables', 'estimated',
      { generic: true });
    line('MARKER-WIC', 'Wire markers, printed per wire number',
      wiring.length * 2, 'pcs', 'Phoenix Contact', 'Consumables', 'estimated');
    line('LABEL-COMPONENT', 'Component identification labels',
      layout.items.length, 'pcs', 'to be specified', 'Consumables',
      'estimated', { generic: true });

    /* Wire length is a rough allowance, NOT a routed length. Flagged so nobody
       mistakes it for a calculated figure — real lengths need Phase 4 routing.
       Groups are derived from the wiring list so no size can be silently
       dropped when the wiring generator gains a new conductor. */
    const AVG_WIRE_M = 1.2;
    const SLUG = { 'Black': 'BK', 'Light blue': 'BU-L', 'Red': 'RD',
                   'Dark blue': 'BU', 'Orange': 'OG', 'Green-yellow': 'GNYE' };
    const groups = new Map();
    for (const w of wiring) {
      const mm2 = parseFloat(w.size);
      if (!Number.isFinite(mm2)) continue;   /* Cat5e, encoder, servo assemblies */
      const key = mm2 + '|' + w.colour;
      if (!groups.has(key)) groups.set(key, { mm2, colour: w.colour, n: 0 });
      groups.get(key).n++;
    }
    /* Pre-made assemblies are bought per cable, not per metre */
    const assemblies = {};
    for (const w of wiring) {
      if (Number.isFinite(parseFloat(w.size))) continue;
      assemblies[w.size] = (assemblies[w.size] || 0) + 1;
    }

    [...groups.values()]
      .sort((a, b) => a.mm2 - b.mm2 || a.colour.localeCompare(b.colour))
      .forEach((g) => {
        const isPe = g.colour === WIRE_COLOUR.pe;
        line('WIRE-' + g.mm2 + '-' + (SLUG[g.colour] || 'XX'),
          (isPe ? 'Earth wire ' : 'Panel wire ') + g.mm2 + ' mm² ' +
          g.colour.toLowerCase(), Math.ceil(g.n * AVG_WIRE_M), 'm',
          'to be specified', 'Consumables', 'estimated',
          { generic: true,
            note: 'Allowance only — ' + AVG_WIRE_M + ' m average per wire, ' +
                  g.n + ' wires' });
      });
    Object.keys(assemblies).sort().forEach((kind) => {
      line('CABLE-' + kind.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase(),
        kind + ' assembly', assemblies[kind], 'pcs', 'to be specified',
        'Consumables', 'estimated',
        { generic: true, note: 'Length per machine layout, not derived here' });
    });

    return out;
  }

  /* ══════════ TUKAR-MENUKAR LIBRARY ══════════
     Format file supaya pengguna bisa saling bertukar library. Sengaja versi
     bernomor: importer menolak apa pun yang tidak dikenalinya, daripada
     menerima setengah-setengah lalu merusak library yang sudah ada. */
  const LIB_FORMAT = 'panel-builder-library';
  const LIB_VERSION = 1;
  /* Field yang boleh ada di satu komponen. Apa pun di luar daftar ini dibuang
     saat import — file dari luar tidak boleh menyuntikkan field sembarangan. */
  const LIB_FIELDS = [
    'asset', 'w', 'h', 'd', 'cat', 'label', 'color', 'bg', 'pn', 'desc', 'vendor',
    'mount', 'powerW', 'dimsVerified', 'custom', 'generic', 'round',
    'isPlc', 'plcName', 'builtinDi', 'builtinDo', 'maxExp',
    'expDi', 'expDo', 'expAi', 'expAo', 'channels',
    /* psuA = kapasitas keluaran 24 V. Tanpa ini, PSU yang di-import masuk
       dengan kapasitas NOL tanpa pesan apa pun: utilisasi PSU melonjak dan
       panel dinyatakan kekurangan daya padahal supply-nya ada di layout. */
    'psuA',
    'hasImage', 'imgVersion',
  ];
  const NUM_FIELDS = ['w', 'h', 'd', 'powerW', 'builtinDi', 'builtinDo', 'maxExp',
                      'imgVersion', 'channels', 'psuA'];
  const BOOL_FIELDS = ['dimsVerified', 'custom', 'generic', 'round', 'isPlc', 'hasImage'];

  /* Bangun objek yang siap di-JSON.stringify. `keys` = komponen yang dipilih. */
  function exportLibrary(patch, keys, opts) {
    const o = opts || {};
    const src = patch || {};
    const db = resolveDb(src);
    const components = {};
    for (const k of keys || []) {
      if (!db[k]) continue;
      /* Ekspor snapshot LENGKAP (bukan hanya override), supaya komponen tetap
         utuh di aplikasi penerima yang mungkin punya bawaan berbeda. */
      const out = {};
      for (const f of LIB_FIELDS) if (db[k][f] !== undefined) out[f] = db[k][f];
      if (!o.images) { delete out.hasImage; delete out.imgVersion; }
      components[k] = out;
    }
    return {
      format: LIB_FORMAT,
      version: LIB_VERSION,
      exported: o.now || new Date().toISOString(),
      app: o.app || 'Panel Builder Assistant',
      by: o.by || '',
      count: Object.keys(components).length,
      components,
      /* {key: dataUrl} — hanya kalau diminta */
      images: o.images ? (o.imageMap || {}) : {},
    };
  }

  /* Periksa & bersihkan file impor. Tidak pernah melempar exception: selalu
     mengembalikan {ok, error, ...} supaya UI bisa menampilkan alasannya. */
  function validateLibraryFile(raw, existingPatch) {
    if (!raw || typeof raw !== 'object')
      return { ok: false, error: 'File bukan objek JSON.' };
    if (raw.format !== LIB_FORMAT)
      return { ok: false, error: 'Bukan file library Panel Builder (format: ' +
               JSON.stringify(raw.format) + ').' };
    if (!Number.isInteger(raw.version) || raw.version < 1)
      return { ok: false, error: 'Nomor versi tidak valid.' };
    if (raw.version > LIB_VERSION)
      return { ok: false, error: 'File dibuat versi aplikasi yang lebih baru (v' +
               raw.version + ', aplikasi ini mendukung v' + LIB_VERSION + ').' };
    if (!raw.components || typeof raw.components !== 'object')
      return { ok: false, error: 'File tidak memuat komponen.' };

    const existing = existingPatch || {};
    const clean = {}, images = {}, skipped = [];
    let isNew = 0, overwrite = 0;

    for (const key of Object.keys(raw.components)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) { skipped.push(key + ' (kode tidak valid)'); continue; }
      const src = raw.components[key];
      if (!src || typeof src !== 'object') { skipped.push(key + ' (bukan objek)'); continue; }
      const out = {};
      for (const f of LIB_FIELDS) {
        if (src[f] === undefined) continue;
        if (NUM_FIELDS.indexOf(f) >= 0) { const n = num(src[f], NaN);
                                          if (Number.isFinite(n)) out[f] = n; continue; }
        if (BOOL_FIELDS.indexOf(f) >= 0) { out[f] = !!src[f]; continue; }
        out[f] = String(src[f]).slice(0, 400);
      }
      if (!out.desc) { skipped.push(key + ' (tanpa deskripsi)'); continue; }
      if (!(out.w > 0 && out.h > 0 && out.d > 0)) {
        skipped.push(key + ' (dimensi tidak valid)'); continue;
      }
      if (out.isPlc && !(num(out.builtinDi, 0) > 0 || num(out.builtinDo, 0) > 0)) {
        /* CPU tanpa I/O bawaan akan merusak hitungan modul — turunkan saja */
        delete out.isPlc; delete out.plcName;
      }
      const img = raw.images && raw.images[key];
      if (typeof img === 'string' && /^data:image\/[a-z+]+;base64,/.test(img))
        images[key] = img;
      else { delete out.hasImage; delete out.imgVersion; }

      clean[key] = out;
      if (existing[key] || COMPONENT_DB[key]) overwrite++; else isNew++;
    }

    if (!Object.keys(clean).length)
      return { ok: false, error: 'Tidak ada komponen yang bisa dipakai. ' +
               (skipped.length ? 'Dilewati: ' + skipped.slice(0, 5).join(', ') : '') };

    return { ok: true, components: clean, images, skipped, isNew, overwrite,
             total: Object.keys(clean).length,
             exported: typeof raw.exported === 'string' ? raw.exported : '',
             by: typeof raw.by === 'string' ? raw.by.slice(0, 120) : '' };
  }

  /* ══════════ small utils ══════════ */
  /* Components whose footprint normally comes from a selection table, so a
     library dimension override pins them rather than tracking the variant. */
  const SELECTION_DRIVEN = ['psu', 'mccb', 'vfd', 'servo', 'contactor', 'overload'];
  const hasDims = (p) => ['w', 'h', 'd'].some((f) => p && p[f] != null);

  function fill(n, v) { return Array(Math.max(0, n)).fill(v); }
  function ov(base, patch) { return Object.assign({}, base, patch); }
  function deepMerge(a, b) {
    const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    for (const k of Object.keys(b || {})) {
      out[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]))
        ? deepMerge(a[k] || {}, b[k]) : b[k];
    }
    return out;
  }

  return {
    compute, buildWiring, normalizeCfg, resolveDb,
    exportLibrary, validateLibraryFile, LIB_FORMAT, LIB_VERSION, LIB_FIELDS,
    COMPONENT_DB, DEFAULT_CFG, ASSUMPTIONS, WIRE_COLOUR,
    BLANK_COMPONENT, SELECTION_DRIVEN, DOOR_KEYS, NO_PLC, LEGACY_PLC,
    /* daftar CPU untuk dropdown — termasuk yang ditambahkan lewat library */
    plcModels: (patch) => {
      const db = resolveDb(patch);
      return Object.keys(db).filter((k) => db[k].isPlc)
        .map((k) => ({ key: k, name: db[k].plcName || db[k].desc, pn: db[k].pn,
                       vendor: db[k].vendor, di: num(db[k].builtinDi, 0),
                       do_: num(db[k].builtinDo, 0), maxExp: num(db[k].maxExp, 0) }))
        .sort((a, b) => (a.vendor + a.name).localeCompare(b.vendor + b.name));
    },
    STD_HEIGHTS, STD_WIDTHS, STD_DEPTHS, STD_SIZES,
    MCCB_FRAMES, MCB_TRIPS, CONTACTORS, OVERLOADS, PSU_LADDER, DRIVES,
    /* exposed for tests */
    _internal: { effectiveSurfaceM2, thermal, selectPsu, selectMccb, selectMcb,
                 selectStarter, packRows, loadSchedule, dcBudget },
  };
});
