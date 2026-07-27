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
    psu:       { asset:'psu-24vdc.png',        w:97,   h:130, d:125, cat:'Power',      label:'Power Supply',    color:'#2478CE', bg:'#E3EEF9', pn:'QUINT4-PS/1AC/24DC/20', desc:'Power supply 24 VDC',                  vendor:'Phoenix Contact',     mount:'rail', powerW:0,  dimsVerified:false },
    contactor: { asset:'contactor.png',        w:45,   h:77,  d:86,  cat:'Switching',  label:'Contactor',       color:'#6B7885', bg:'#EEF1F4', pn:'LC1D09BD',              desc:'Contactor AC-3, coil 24 VDC',          vendor:'Schneider Electric',  mount:'rail', powerW:2,  dimsVerified:false },
    overload:  { asset:'thermal-overload.png', w:45,   h:70,  d:68,  cat:'Protection', label:'',                color:'#6B7885', bg:'#EEF1F4', pn:'LRD10',                 desc:'Thermal overload relay',               vendor:'Schneider Electric',  mount:'rail', powerW:0,  dimsVerified:false },
    safety:    { asset:'safety-relay.png',     w:22.5, h:99,  d:115, cat:'Safety',     label:'Safety Relay',    color:'#0F7A6C', bg:'#DDF1EE', pn:'PSR-SCP-24DC/ESD/4X1',  desc:'Safety relay dual channel 4 NO',       vendor:'Phoenix Contact',     mount:'rail', powerW:4,  dimsVerified:false },
    irelay:    { asset:'interface-relay.png',  w:15,   h:80,  d:90,  cat:'Switching',  label:'Relays',          color:'#6B7885', bg:'#EEF1F4', pn:'RIF-0-RPT-24DC',        desc:'Interface relay slim 24 VDC + socket', vendor:'Phoenix Contact',     mount:'rail', powerW:0.5,dimsVerified:false },
    plc:       { asset:'plc-fx5u-32m.png',     w:150,  h:90,  d:83,  cat:'Control',    label:'PLC',             color:'#2478CE', bg:'#E3EEF9', pn:'FX5U-32MT/ES',          desc:'PLC CPU 16 DI / 16 DO, Ethernet',      vendor:'Mitsubishi Electric', mount:'rail', powerW:30, dimsVerified:false },
    di16:      { asset:'io-module-16di.png',   w:40,   h:90,  d:83,  cat:'Control',    label:'I/O Modules',     color:'#2478CE', bg:'#E3EEF9', pn:'FX5-16EX/ES',           desc:'Expansion module 16 DI',               vendor:'Mitsubishi Electric', mount:'rail', powerW:5,  dimsVerified:false },
    do16:      { asset:'io-module-16do.png',   w:40,   h:90,  d:83,  cat:'Control',    label:'',                color:'#2478CE', bg:'#E3EEF9', pn:'FX5-16EYT/ES',          desc:'Expansion module 16 DO transistor',    vendor:'Mitsubishi Electric', mount:'rail', powerW:5,  dimsVerified:false },
    ad4:       { asset:'analog-module-4ad.png',w:40,   h:90,  d:83,  cat:'Control',    label:'',                color:'#2478CE', bg:'#E3EEF9', pn:'FX5-4AD',               desc:'Analog input module 4 ch',             vendor:'Mitsubishi Electric', mount:'rail', powerW:5,  dimsVerified:false },
    da4:       { asset:'analog-module-4da.png',w:40,   h:90,  d:83,  cat:'Control',    label:'',                color:'#2478CE', bg:'#E3EEF9', pn:'FX5-4DA',               desc:'Analog output module 4 ch',            vendor:'Mitsubishi Electric', mount:'rail', powerW:5,  dimsVerified:false },
    eth:       { asset:'ethernet-switch-8p.png',w:52,  h:135, d:105, cat:'Network',    label:'Ethernet Switch', color:'#0F7A6C', bg:'#DDF1EE', pn:'FL-SWITCH-1008N',       desc:'Ethernet switch industrial 8 port',    vendor:'Phoenix Contact',     mount:'rail', powerW:8,  dimsVerified:false },
    mcb3:      { asset:'mcb-3p.png',           w:54,   h:90,  d:70,  cat:'Protection', label:'MCB',             color:'#6B7885', bg:'#EEF1F4', pn:'MCB-3P-C16',            desc:'MCB 3P curve C, drives feeder',        vendor:'Schneider Electric',  mount:'rail', powerW:0,  dimsVerified:false },
    mcb1:      { asset:'mcb-1p.png',           w:18,   h:90,  d:70,  cat:'Protection', label:'',                color:'#6B7885', bg:'#EEF1F4', pn:'MCB-1P-C6',             desc:'MCB 1P curve C, control',              vendor:'Schneider Electric',  mount:'rail', powerW:0,  dimsVerified:false },
    vfd:       { asset:'vfd.png',              w:108,  h:128, d:145, cat:'Drives',     label:'VFD Drives',      color:'#5B4BB5', bg:'#EAE7F8', pn:'FR-D740-2.2K',          desc:'Inverter VFD',                         vendor:'Mitsubishi Electric', mount:'rail', powerW:0,  dimsVerified:false },
    servo:     { asset:'servo.png',            w:85,   h:168, d:195, cat:'Drives',     label:'Servo Drives',    color:'#B03A6C', bg:'#F8E4ED', pn:'MR-J4-100A4',           desc:'Servo amplifier',                      vendor:'Mitsubishi Electric', mount:'rail', powerW:0,  dimsVerified:false },
    fan:       { asset:'cooling-fan-150.png',  w:150,  h:150, d:100, cat:'Cooling',    label:'Filter Fan',      color:'#6B7885', bg:'#EEF1F4', pn:'SK-3239-100',           desc:'Filter fan 150 mm (door/side mounted)',vendor:'Rittal',              mount:'door', powerW:0,  dimsVerified:false },

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
  };
  /* Door devices never consume backplate space; they are laid out separately. */
  const DOOR_KEYS = ['estop','hmi','disconnect','pb_start','pb_stop','pb_reset',
                     'sel_auto','lamp_pwr','lamp_run','lamp_flt'];

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
    fan: 'E',
  };
  /* Fixed numbers for the door devices, so START is always S3 on every drawing */
  const DOOR_TAG = { disconnect: 'Q1', estop: 'S1', sel_auto: 'S2',
                     pb_start: 'S3', pb_stop: 'S4', pb_reset: 'S5',
                     lamp_pwr: 'H1', lamp_run: 'H2', lamp_flt: 'H3' };

  /* Stable identity per placed device: type plus its ordinal among its kind.
     Manual door positions are keyed on this, so they survive a reorder. */
  function designate(items, fixed) {
    const perKind = {}, perPrefix = {};
    return items.map((it) => {
      perKind[it.type] = (perKind[it.type] || 0) + 1;
      const ord = perKind[it.type];
      const id = it.type + '#' + ord;
      let tag;
      if (fixed && fixed[it.type]) {
        const total = items.filter((x) => x.type === it.type).length;
        tag = fixed[it.type] + (total > 1 ? '.' + ord : '');
      } else {
        const p = DESIGNATION[it.type] || 'X';
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
    plc: 'Mitsubishi FX5U',
    di: 24, do_: 16, ai: 4, ao: 2,
    vfd: 3, servo: 2, hmi: 2, motor: 6, valve: 5,
    supplyV: 400,     /* 3-phase line voltage at the incoming terminals */
    ambientC: 30,     /* design ambient outside the enclosure */
    cabW: 800,        /* per-project, was a global setting */
    cabH: 0,          /* 0 = derive height from the layout; else a fixed size */
    extras: [],       /* [{type, qty, rail}] — library components added by hand */
    doorPos: {},      /* {'estop#1': {x,y}} — manual front-cover placement, mm */
  };
  const NO_PLC = 'none';

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
    c.hasPlc = c.plc !== NO_PLC && !!c.plc;
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
    c.extras = (Array.isArray(c.extras) ? c.extras : [])
      .filter((e) => e && e.type)
      .map((e) => ({
        type: String(e.type),
        qty: Math.max(1, clampInt(e.qty) || 1),
        rail: [1, 2, 3].indexOf(+e.rail) >= 0 ? +e.rail : 2,
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
  function loadSchedule(c, A) {
    const V = c.supplyV, root3 = Math.sqrt(3);
    const dol = Math.max(0, c.motor - c.vfd - c.servo);
    const rows = [];

    const add = (name, qty, shaftW, pf, eff, opts) => {
      if (qty <= 0) return;
      const pIn = shaftW / eff;                 /* real power drawn per unit */
      const s = pIn / pf;                       /* apparent power per unit */
      const a = s / (root3 * V);                /* line current per unit */
      rows.push(Object.assign({
        name, qty, shaftW,
        pf, eff,
        pInEach: pIn, pIn: pIn * qty,
        sEach: s, s: s * qty,
        aEach: a, a: a * qty,
        startEach: a,                           /* soft-started unless overridden */
      }, opts || {}));
    };

    add('VFD ' + A.vfdKw + ' kW', c.vfd, A.vfdKw * 1000, A.pf.vfd,
        A.eff.vfdDrive * A.eff.vfdMotor);
    add('Servo ' + A.servoW + ' W', c.servo, A.servoW, A.pf.servo,
        A.eff.servoDrive * A.eff.servoMotor);
    add('Motor DOL ' + A.dolKw + ' kW', dol, A.dolKw * 1000, A.pf.dol,
        A.eff.dolMotor);
    /* DOL is the only load with locked-rotor inrush */
    const dolRow = rows.find((r) => r.name.indexOf('DOL') >= 0);
    if (dolRow) dolRow.startEach = dolRow.aEach * A.dolStartMultiple;

    return { rows, dol };
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

    /* ── module counts ─────────────────────────────────────────────── */
    const hasPlc = c.hasPlc;
    /* Without a CPU there is no I/O rack at all — a relay-logic or purely
       motor-starter panel. The I/O figures are kept in the config (so nothing
       is destroyed if a PLC is chosen again) but they buy no hardware. */
    const diExtra = hasPlc ? Math.ceil(Math.max(0, c.di - 16) / 16) : 0;
    const doExtra = hasPlc ? Math.ceil(Math.max(0, c.do_ - 16) / 16) : 0;
    const aiMods  = hasPlc ? Math.ceil(c.ai / 4) : 0;   /* FX5-4AD is 4 channels */
    const aoMods  = hasPlc ? Math.ceil(c.ao / 4) : 0;   /* FX5-4DA is 4 channels */
    const relays  = c.valve;                  /* one per solenoid, no cap */
    const dol     = Math.max(0, c.motor - c.vfd - c.servo);
    const expansionModules = diExtra + doExtra + aiMods + aoMods;
    const counts = { diExtra, doExtra, aiMods, aoMods, relays, dol, hasPlc };

    if (!hasPlc && (c.di || c.do_ || c.ai || c.ao))
      warnings.push({ level: 'warn', code: 'IO_WITHOUT_PLC',
        msg: 'No PLC selected, so the ' + (c.di + c.do_ + c.ai + c.ao) +
             ' configured I/O points buy no modules and are not wired to a CPU. ' +
             'Field devices are still terminated on the terminal strip.' });
    if (!hasPlc && c.hmi > 0)
      warnings.push({ level: 'warn', code: 'HMI_WITHOUT_PLC',
        msg: c.hmi + ' HMI configured without a PLC — it has nothing to talk to. ' +
             'Remove it or select a PLC.' });
    if (expansionModules > A.maxExpansionModules)
      warnings.push({ level: 'error', code: 'BUS_LIMIT',
        msg: expansionModules + ' expansion modules exceed the FX5U limit of ' +
             A.maxExpansionModules + '. Split across a second CPU or use remote I/O.' });
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

    const dolFlc = dol > 0
      ? (A.dolKw * 1000 / A.eff.dolMotor) / (Math.sqrt(3) * c.supplyV * A.pf.dol)
      : 0;
    const starter = dol > 0 ? selectStarter(A.dolKw, dolFlc) : null;

    /* ── drives by voltage class ───────────────────────────────────── */
    const vfdSpec = DRIVES.vfd[c.voltClass];
    const servoSpec = DRIVES.servo[c.voltClass];
    if (c.servo > 0 && servoSpec.ratedW > A.servoW)
      warnings.push({ level: 'info', code: 'SERVO_FRAME',
        msg: 'No ' + A.servoW + ' W amplifier in the ' + c.voltClass +
             ' V class; using the next frame up (' + servoSpec.pn + ', ' +
             servoSpec.ratedW + ' W).' });

    /* Resolve the live selections into the component specs used for layout */
    const specs = Object.assign({}, db);
    const psuPick = selectPsu(dc.aTotal, c.ambientC, A);
    specs.mccb  = ov(specs.mccb,  { pn: mccb.pn, w: mccb.w, h: mccb.h, d: mccb.d,
                                    desc: 'Main breaker MCCB 3P ' + mccb.tripA + ' A' });
    specs.psu   = ov(specs.psu,   { pn: psuPick.pn, w: psuPick.w, h: psuPick.h,
                                    d: psuPick.d,
                                    desc: 'Power supply 24 VDC ' + psuPick.ratedA + ' A' });
    specs.vfd   = ov(specs.vfd,   { pn: vfdSpec.pn, w: vfdSpec.w, h: vfdSpec.h,
                                    d: vfdSpec.d,
                                    desc: 'Inverter VFD ' + A.vfdKw + ' kW ' +
                                          c.voltClass + ' V' });
    specs.servo = ov(specs.servo, { pn: servoSpec.pn, w: servoSpec.w, h: servoSpec.h,
                                    d: servoSpec.d,
                                    desc: 'Servo amplifier ' + servoSpec.ratedW +
                                          ' W ' + c.voltClass + ' V' });
    specs.mcb3  = ov(specs.mcb3,  { pn: driveMcb.pn,
                                    desc: 'MCB 3P C' + driveMcb.tripA + ' drives feeder' });
    specs.mcb1  = ov(specs.mcb1,  { pn: controlMcb.pn,
                                    desc: 'MCB 1P C' + controlMcb.tripA + ' control' });
    if (starter) {
      specs.contactor = ov(specs.contactor, { pn: starter.contactor.pn,
        w: starter.contactor.w, h: starter.contactor.h, d: starter.contactor.d,
        desc: 'Contactor ' + starter.contactor.ac3A + ' A AC-3, coil 24 VDC' });
      specs.overload = ov(specs.overload, { pn: starter.overload.pn,
        desc: 'Thermal overload ' + starter.overload.min + '–' +
              starter.overload.max + ' A, set ' + starter.setA.toFixed(1) + ' A' });
    }

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

    /* ── thermal (needs a size; size needs a layout; so: layout first) ── */
    const rail1 = ['mccb', 'spd', 'psu']
      .concat(fill(dol, 'contactor'), fill(dol, 'overload'));
    /* An Ethernet switch only earns its place if there is something to network */
    const needsEth = hasPlc || c.hmi > 0;
    const rail2 = (hasPlc ? ['plc'] : [])
      .concat(fill(diExtra, 'di16'), fill(doExtra, 'do16'),
              fill(aiMods, 'ad4'), fill(aoMods, 'da4'),
              needsEth ? ['eth'] : [], ['safety', 'mcb3'],
              fill(2 + c.hmi, 'mcb1'), fill(relays, 'irelay'));
    const rail3 = fill(c.vfd, 'vfd').concat(fill(c.servo, 'servo'));

    /* Components the user added by hand from the library */
    const railOf = { 1: rail1, 2: rail2, 3: rail3 };
    for (const e of c.extras) {
      if (!specs[e.type]) {
        warnings.push({ level: 'error', code: 'UNKNOWN_COMPONENT',
          msg: 'Added component "' + e.type + '" is not in the library; ' +
               'it was skipped. Re-add it or remove it from this project.' });
        continue;
      }
      for (let i = 0; i < e.qty; i++) railOf[e.rail].push(e.type);
    }

    /* Provisional fan count so the reserved column is right; refined below. */
    let fanCount = 1, layout = null, dims = null, th = null;
    for (let pass = 0; pass < 4; pass++) {
      layout = buildLayout({ rail1, rail2, rail3 }, {
        W, PAD, GAP, GAPV, DUCT, TSTRIP, fanCount, spec,
      });
      const maxDepth = Math.max.apply(null,
        layout.items.map((i) => spec(i.type).d).concat([100]));
      dims = {
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
      th = thermal(heat.totalW, dims, c.ambientC, A);
      if (th.fans === fanCount) { th.heat = heat; break; }
      fanCount = th.fans;
      th.heat = heat;
    }
    const heat = th.heat;

    /* ── door layout (needs the final enclosure size) ───────────────── */
    const door = buildDoorLayout(c, counts, spec, dims.W, dims.H, A);

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
    if (psuPick.undersized)
      warnings.push({ level: 'error', code: 'PSU_SHORT',
        msg: 'No supply in the table covers ' + dc.aTotal.toFixed(1) +
             ' A at ' + Math.round(A.psuMaxUtil * 100) + '% utilisation.' });
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
    const bom = buildBom({
      layout, door, dims, specs, counts, cfg: c, termPoints, powerTerms,
      controlTerms, spares, wiring, thermal: th, assumptions: A,
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
      /* front cover */
      door, hasPlc,
      railLengthMm: layout.railLengthMm, railFreeMm: layout.railFreeMm,
      ductLengthMm: layout.ductLengthMm,
      /* electrical */
      schedule: sched.rows, dol, diExtra, doExtra, aiMods, aoMods, relays,
      dcLoad: dc.wTotal, dcInternalW: dc.wInternal, dcExternalW: dc.wExternal,
      dcAmps: dc.aTotal, dcDetail: dc,
      totalW: totalPIn, totalVA: totalS, systemPf,
      flcA, startA, peakA: flcA,
      psu: psuPick, psuA: psuPick.ratedA, util: psuPick.utilPct,
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
    const { W, PAD, GAP, GAPV, DUCT, TSTRIP, fanCount, spec } = o;
    /* Reserve a right-hand column for door/side-mounted fans. They do not sit
       on the backplate, but keeping the column clear guarantees the airflow
       path and wiring space stays free. */
    const fanW = fanCount > 0 ? spec('fan').w + GAP : 0;
    const usableW = W - PAD * 2 - fanW;

    const rows = [];
    let y = PAD, overflow = false, railLengthMm = 0, railUsedMm = 0;

    const emitRailGroup = (list, title) => {
      const chunks = packRows(list, usableW, GAP, spec);
      chunks.forEach((chunk, i) => {
        if (!chunk.length) return;
        const h = Math.max(60, ...chunk.map((t) => spec(t).h));
        const stackH = chunk.indexOf('contactor') >= 0
          ? spec('contactor').h + 4 + spec('overload').h : 0;
        const rowH = Math.max(h, stackH);
        const used = chunk.reduce((t, x) => t + spec(x).w + GAP, 0) - GAP;
        if (chunk.some((t) => spec(t).w > usableW)) overflow = true;
        railLengthMm += W - PAD * 2;
        railUsedMm += Math.max(0, used);
        rows.push({ list: chunk, h: rowH, railY: y + rowH / 2,
                    name: title + (chunks.length > 1 ? ' (' + (i + 1) + '/' +
                          chunks.length + ')' : '') });
        y += rowH + GAPV;
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
    emitBand('tstrip', TSTRIP, 'TERMINAL BLOCKS X1–X4');

    /* The fan column is reserved space too — if it is taller than the rails,
       it sets the cabinet height, otherwise the fans would fall outside. */
    const fanColH = fanCount > 0
      ? PAD + fanCount * (spec('fan').h + GAP) - GAP + PAD : 0;
    const needH = Math.max(y - GAPV + PAD, fanColH);

    /* place components */
    let items = [];
    for (const row of rows) {
      if (!row.list) continue;
      let x = PAD;
      for (const t of row.list) {
        const d = spec(t);
        if (t === 'overload') {
          /* overload hangs under its own contactor, same x */
          const hosts = items.filter((i) => i.type === 'contactor');
          const mine = items.filter((i) => i.type === 'overload').length;
          if (hosts[mine]) {
            items.push({ type: t, x: hosts[mine].x,
              y: hosts[mine].y + (spec('contactor').h + d.h) / 2 + 4 });
          }
          continue;
        }
        const yPos = (t === 'contactor')
          ? row.railY - (spec('overload').h + 4) / 2 : row.railY;
        items.push({ type: t, x: x + d.w / 2, y: yPos });
        x += d.w + GAP;
      }
    }
    /* fans stacked down the reserved column */
    for (let i = 0; i < fanCount; i++) {
      const f = spec('fan');
      items.push({ type: 'fan', x: W - PAD - f.w / 2,
                   y: PAD + f.h / 2 + i * (f.h + GAP), doorMounted: true });
    }

    const ductLengthMm = rows.filter((r) => r.kind === 'duct')
      .reduce((t) => t + (W - PAD * 2), 0);

    /* tag every placed component so drawing, schedule and BOM agree */
    items = designate(items);

    return { rows, items, needH, overflow, usableW,
             railLengthMm, railFreeMm: Math.max(0, railLengthMm - railUsedMm),
             ductLengthMm };
  }

  /* ══════════ FRONT COVER (DOOR) LAYOUT ══════════
     Operator devices on the door. Zones run top to bottom; the E-stop gets a
     reserved top-right block because IEC 60204-1 §10.7 wants it unobstructed
     and immediately reachable, so nothing else may crowd it. */
  function buildDoorLayout(c, counts, spec, W, H, A) {
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

    /* Identify before overriding — manual positions are keyed on the id. */
    let placed = designate(items, DOOR_TAG);

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

    return { items: placed, zones, margin: M, manual, outside, draggedOutside,
             neededH: Math.max(ext.h + M, M + est.h + M),
             neededW: ext.w + M,
             fits: ext.h <= H && ext.w <= W && !outside.length };
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
    /* switchgear I²R */
    const n = (t) => layout.items.filter((i) => i.type === t).length;
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
    for (let i = 1; i <= (o.fans || 0); i++)
      add('X0:1 / X0:2', 'Filter fan FAN' + i, '0.75 mm²', C.dcControl, 'Cooling');

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
    for (const it of layout.items.concat(o.door ? o.door.items : []))
      agg[it.type] = (agg[it.type] || 0) + 1;
    for (const t of Object.keys(agg)) {
      const d = specs[t];
      line(d.pn, d.desc, agg[t], 'pcs', d.vendor, d.cat, 'calculated',
        { dimsVerified: d.dimsVerified, door: d.mount === 'door' });
    }
    /* legend engraving / labels for the operator devices */
    const doorCount = o.door ? o.door.items.length : 0;
    if (doorCount)
      line('LEGEND-PLATE', 'Legend plate / engraved label for door device',
        doorCount, 'pcs', 'to be specified', 'Consumables', 'estimated',
        { generic: true });
    /* outlet filter always pairs with a fan */
    if (th.fans > 0)
      line('SK-3239-200', 'Outlet filter 150 mm (matches filter fan)',
        th.fans, 'pcs', 'Rittal', 'Cooling', 'calculated');
    if (th.method === 'cooling-unit')
      line('COOLING-UNIT-TBD',
        'Cooling unit / air-air heat exchanger — ' + Math.round(th.requiredM3h) +
        ' m³/h class, select from vendor range', 1, 'pcs', 'to be specified',
        'Cooling', 'calculated', { generic: true });

    /* ── consumables: absent from the prototype BOM entirely ── */
    line('UT-6', 'Feed-through terminal 6 mm² (power)', powerTerms, 'pcs',
      'Phoenix Contact', 'Terminals', 'calculated');
    line('UT-2.5', 'Feed-through terminal 2.5 mm² (control)', controlTerms,
      'pcs', 'Phoenix Contact', 'Terminals', 'calculated');
    line('UT-2.5-SPARE', 'Terminal 2.5 mm², installed spare (' +
      Math.round(o.assumptions.terminalSparePct * 100) + '%)', spares, 'pcs',
      'Phoenix Contact', 'Terminals', 'calculated');
    line('CLIPFIX-35', 'End clamp for terminal strips', 8, 'pcs',
      'Phoenix Contact', 'Terminals', 'estimated');
    line('D-UT-2.5', 'End cover for terminal strips', 4, 'pcs',
      'Phoenix Contact', 'Terminals', 'estimated');
    line('PE-BAR-12', 'PE busbar, 12-way', 1, 'pcs', 'to be specified',
      'Terminals', 'calculated', { generic: true });

    line('DIN-TS35-2M', 'DIN rail TS35 ×7.5, 2 m length',
      Math.ceil(layout.railLengthMm / 2000), 'pcs', 'to be specified',
      'Mechanical', 'calculated', { generic: true });
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
    COMPONENT_DB, DEFAULT_CFG, ASSUMPTIONS, WIRE_COLOUR,
    BLANK_COMPONENT, SELECTION_DRIVEN, DOOR_KEYS, NO_PLC,
    STD_HEIGHTS, STD_WIDTHS, STD_DEPTHS, STD_SIZES,
    MCCB_FRAMES, MCB_TRIPS, CONTACTORS, OVERLOADS, PSU_LADDER, DRIVES,
    /* exposed for tests */
    _internal: { effectiveSurfaceM2, thermal, selectPsu, selectMccb, selectMcb,
                 selectStarter, packRows, loadSchedule, dcBudget },
  };
});
