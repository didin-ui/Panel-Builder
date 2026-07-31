/* Panel Builder Assistant — engine tests.  Run: npm test  (Node 18+, no deps)

   Two kinds of test here:
     GOLDEN     — pins the headline numbers for the reference machine, so an
                  accidental change to a constant shows up as a diff.
     INVARIANTS — properties that must hold for EVERY config. These are the
                  ones that catch real regressions; the golden numbers only
                  catch change, not wrongness.                                */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');

const cfg = (over) => Object.assign({}, E.DEFAULT_CFG, over || {});
const R = (over) => E.compute(cfg(over));

/* A spread of configs the invariants run against, including degenerate ones. */
const MATRIX = [
  { name: 'reference', c: {} },
  { name: 'empty panel', c: { di: 0, do_: 0, ai: 0, ao: 0, vfd: 0, servo: 0, hmi: 0, motor: 0, valve: 0 } },
  { name: 'io only', c: { vfd: 0, servo: 0, motor: 0 } },
  { name: 'io heavy', c: { di: 128, do_: 96, ai: 16, ao: 8, valve: 24 } },
  { name: 'drive heavy', c: { vfd: 6, servo: 6, motor: 12 } },
  { name: 'dol only', c: { vfd: 0, servo: 0, motor: 8 } },
  { name: '200 V supply', c: { supplyV: 200 } },
  { name: '230 V supply', c: { supplyV: 230 } },
  { name: 'hot ambient', c: { ambientC: 45 } },
  { name: 'narrow cabinet', c: { cabW: 400 } },
  { name: 'wide cabinet', c: { cabW: 1200 } },
  { name: 'single of everything', c: { di: 1, do_: 1, ai: 1, ao: 1, vfd: 1, servo: 1, hmi: 1, motor: 1, valve: 1 } },
];
const forEachCase = (fn) => MATRIX.forEach(({ name, c }) => test(name, () => fn(R(c), cfg(c))));

/* ════════════════════════════════════════════════════════════════════ */
describe('golden — reference machine (24DI/16DO/4AI/2AO, 3 VFD, 2 servo, 6 motors)', () => {
  const r = R();

  test('electrical', () => {
    assert.equal(Math.round(r.totalW), 11768);          // real input power, W
    assert.equal(Math.round(r.totalVA), 12803);         // apparent power, VA
    assert.equal(r.systemPf.toFixed(3), '0.919');       // computed, not assumed
    assert.equal(r.flcA.toFixed(2), '18.48');
    assert.equal(r.startA.toFixed(2), '36.63');         // largest DOL inrushing
  });

  test('protection follows the calculation', () => {
    assert.equal(r.mccb.pn, 'NF32-SV-3P-25A');
    assert.equal(r.mccb.tripA, 25);
    assert.equal(r.driveMcb.pn, 'MCB-3P-C20');
    assert.equal(r.controlMcb.pn, 'MCB-1P-C6');
    assert.equal(r.starter.contactor.pn, 'LC1D09BD');
    assert.equal(r.starter.overload.pn, 'LRD08');
  });

  test('24 V budget and PSU', () => {
    assert.equal(r.dcInternalW.toFixed(1), '93.5');   // incl. 2 W door lamps
    assert.equal(r.dcExternalW.toFixed(1), '26.9');
    assert.equal(r.psu.pn, 'QUINT4-PS/1AC/24DC/10');
    assert.equal(Math.round(r.util), 50);
  });

  test('thermal', () => {
    assert.equal(r.heat, 403);
    assert.equal(r.thermal.Ae.toFixed(3), '2.328');
    assert.equal(r.thermal.method, 'forced');
    assert.equal(r.fans, 2);
    assert.equal(Math.round(r.thermal.requiredCfm), 63);
    assert.equal(r.temp, 35);
  });

  test('enclosure and schedules', () => {
    assert.deepEqual([r.W, r.H, r.D], [800, 1200, 300]);
    assert.equal(r.termPoints, 92);
    assert.equal(r.wires, 119);
    assert.equal(r.bom.length, 60);   // 59 + pengencang backplate untuk drive
  });

  test('front cover', () => {
    assert.equal(r.door.fits, true);
    assert.equal(r.door.items.length, 12);
    assert.equal(r.door.items.filter((i) => i.type === 'estop').length, 1);
    assert.equal(r.door.items.filter((i) => i.type === 'hmi').length, 2);
  });
});

/* ════════════════════════════════════════════════════════════════════ */
describe('invariant — nothing is NaN or Infinity', () => {
  forEachCase((r) => {
    const bad = [];
    (function scan(o, path) {
      if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(path); return; }
      if (o && typeof o === 'object') Object.keys(o).forEach((k) => scan(o[k], path + '.' + k));
    })(r, 'R');
    assert.deepEqual(bad, [], 'non-finite at: ' + bad.join(', '));
  });
});

describe('invariant — PSU keeps its design headroom', () => {
  forEachCase((r) => {
    if (r.psu.undersized) return;   // reported as an error instead
    assert.ok(r.util <= E.ASSUMPTIONS.psuMaxUtil * 100 + 1e-9,
      `utilisation ${r.util.toFixed(1)}% exceeds the ` +
      `${E.ASSUMPTIONS.psuMaxUtil * 100}% cap`);
    assert.ok(r.psu.ratedA * r.psu.derate >= r.dcAmps, 'supply cannot carry the load');
  });
});

describe('invariant — fan count agrees everywhere', () => {
  forEachCase((r) => {
    const inLayout = r.side.items.filter((i) => i.type === 'fan').length;
    const fanLine = r.bom.find((b) => b.pn === 'SK-3239-100');
    const filterLine = r.bom.find((b) => b.pn === 'SK-3239-200');
    assert.equal(inLayout, r.thermal.fans, 'layout vs thermal');
    assert.equal(fanLine ? fanLine.qty : 0, r.thermal.fans, 'BOM vs thermal');
    assert.equal(filterLine ? filterLine.qty : 0, r.thermal.fans,
      'every fan needs a matching outlet filter');
    const fanWires = r.wiring.filter((w) => /Exhaust fan/.test(w.to)).length;
    assert.equal(fanWires, r.thermal.fans, 'wiring vs thermal');
  });
});

describe('invariant — every component sits inside the backplate', () => {
  forEachCase((r) => {
    if (r.overflow) return;   // reported as an error instead
    for (const it of r.items) {
      /* resolved specs, not DB defaults — selection changes the footprint */
      const d = r.specs[it.type];
      const w = d.w, h = d.h;
      assert.ok(it.x - w / 2 >= -0.01, `${it.type} off the left edge`);
      assert.ok(it.x + w / 2 <= r.W + 0.01, `${it.type} past the right edge`);
      assert.ok(it.y - h / 2 >= -0.01, `${it.type} above the top edge`);
      assert.ok(it.y + h / 2 <= r.H + 0.01,
        `${it.type} below the bottom edge (${(it.y + h / 2).toFixed(0)} > ${r.H})`);
    }
  });
});

describe('invariant — drive voltage class matches the supply', () => {
  [[200, 'FR-D720-2.2K', 'MR-JE-70A'], [230, 'FR-D720-2.2K', 'MR-JE-70A'],
   [400, 'FR-D740-2.2K', 'MR-J4-100A4'], [415, 'FR-D740-2.2K', 'MR-J4-100A4']]
    .forEach(([v, vfdPn, servoPn]) => {
      test(v + ' V', () => {
        const r = R({ supplyV: v });
        const pns = r.bom.map((b) => b.pn);
        assert.ok(pns.includes(vfdPn), `expected ${vfdPn} at ${v} V, got ${pns.join()}`);
        assert.ok(pns.includes(servoPn), `expected ${servoPn} at ${v} V`);
      });
    });
});

describe('invariant — no silent truncation', () => {
  test('one interface relay per solenoid, at any count', () => {
    for (const valve of [0, 1, 5, 8, 9, 24, 60]) {
      const r = R({ valve, do_: Math.max(valve, 16) });
      assert.equal(r.relays, valve);
      assert.equal(r.items.filter((i) => i.type === 'irelay').length, valve);
    }
  });
  test('every DI and DO appears in the wiring list', () => {
    for (const [di, do_] of [[8, 8], [24, 16], [64, 48], [128, 96]]) {
      const r = R({ di, do_, valve: 0 });
      assert.equal(r.wiring.filter((w) => w.note === 'Digital input').length, di);
      assert.equal(r.wiring.filter((w) => w.note === 'Digital output').length, do_);
    }
  });
  test('analog modules scale per 4 channels', () => {
    for (const ai of [0, 1, 4, 5, 8, 12, 16]) {
      const r = R({ ai });
      assert.equal(r.aiMods, Math.ceil(ai / 4));
      assert.equal(r.items.filter((i) => i.type === 'ad4').length, Math.ceil(ai / 4));
    }
  });
});

describe('invariant — monotonicity', () => {
  test('more inputs never reduces modules or terminals', () => {
    let mods = -1, terms = -1;
    for (const di of [0, 8, 16, 17, 32, 48, 64, 96, 128]) {
      const r = R({ di });
      const m = r.diExtra;
      assert.ok(m >= mods, `modules fell at di=${di}`);
      assert.ok(r.termPoints >= terms, `terminals fell at di=${di}`);
      mods = m; terms = r.termPoints;
    }
  });
  test('more load never reduces the incoming breaker', () => {
    let trip = -1, flc = -1;
    for (const vfd of [0, 1, 2, 3, 4, 5, 6]) {
      const r = R({ vfd, motor: Math.max(6, vfd) });
      assert.ok(r.mccb.tripA >= trip, `trip fell at vfd=${vfd}`);
      assert.ok(r.flcA >= flc - 1e-9, `FLC fell at vfd=${vfd}`);
      trip = r.mccb.tripA; flc = r.flcA;
    }
  });
  test('breaker always covers the load with margin', () => {
    forEachCaseInline((r) => {
      if (r.mccb.overRange) return;
      assert.ok(r.mccb.tripA >= r.flcA * E.ASSUMPTIONS.breakerMargin - 1e-9,
        `${r.mccb.tripA} A trip under-covers ${r.flcA.toFixed(1)} A FLC`);
    });
  });
});

describe('invariant — heat excludes field devices', () => {
  test('adding solenoids adds far less heat than their power', () => {
    const a = R({ valve: 0, do_: 32 });
    const b = R({ valve: 20, do_: 32 });
    const addedFieldPower = b.dcExternalW - a.dcExternalW;
    const addedHeat = b.heat - a.heat;
    assert.ok(addedFieldPower > 40, 'sanity: field power should have grown');
    assert.ok(addedHeat < addedFieldPower,
      'field-device power must not be charged to the cabinet in full');
  });
  test('a bigger cabinet runs cooler for the same load', () => {
    const narrow = R({ cabW: 600 });
    const wide = R({ cabW: 1200 });
    assert.ok(wide.thermal.Ae > narrow.thermal.Ae);
    assert.ok(wide.thermal.naturalDT < narrow.thermal.naturalDT,
      'surface area must affect temperature rise');
  });
  test('ambient at or above the ceiling demands a cooling unit', () => {
    const r = R({ ambientC: 42 });
    assert.equal(r.thermal.method, 'cooling-unit');
    assert.equal(r.thermal.fans, 0);
    assert.ok(r.bom.some((b) => b.pn === 'COOLING-UNIT-TBD'));
  });
});

describe('invariant — enclosure sizing', () => {
  forEachCase((r) => {
    const deepest = Math.max(...r.items.map((i) => r.specs[i.type].d));
    assert.ok(r.D >= deepest, `depth ${r.D} does not fit a ${deepest} mm component`);
    assert.ok(E.STD_DEPTHS.includes(r.D), 'depth must be a standard size');
    if (!r.dims.nonStandardH) assert.ok(E.STD_HEIGHTS.includes(r.H));
    assert.ok(r.H >= r.needH, 'height must cover the required stack');
    assert.equal(r.dims.freeStanding, r.H > 800);
  });
});

describe('invariant — BOM completeness and honesty', () => {
  forEachCase((r) => {
    const cats = new Set(r.bom.map((b) => b.cat));
    for (const need of ['Enclosure', 'Terminals', 'Mechanical', 'Consumables'])
      assert.ok(cats.has(need), `BOM is missing the ${need} category`);
    assert.ok(r.bom.some((b) => /^ENC-/.test(b.pn)), 'no enclosure line');
    assert.ok(r.bom.some((b) => b.pn === 'DIN-TS35-2M'), 'no DIN rail line');
    assert.ok(r.bom.some((b) => b.pn === 'PE-BAR-12'), 'no PE bar line');
    for (const b of r.bom) {
      assert.ok(b.qty > 0, `${b.pn} has qty ${b.qty}`);
      assert.ok(['calculated', 'estimated'].includes(b.source),
        `${b.pn} has an unknown provenance`);
      /* regression guard: the prototype invented stock status by row index */
      for (const forbidden of ['status', 'stock', 'leadTime', 'lead_time', 'availability'])
        assert.ok(!(forbidden in b),
          `${b.pn} carries a fabricated "${forbidden}" field`);
    }
  });
});

describe('invariant — layout bookkeeping', () => {
  forEachCase((r) => {
    assert.ok(r.railFreeMm >= 0, 'negative free rail');
    assert.ok(r.railFreeMm <= r.railLengthMm, 'free rail exceeds total rail');
    for (const it of r.items)
      assert.ok(r.specs[it.type], `unknown component type "${it.type}"`);
    const railRows = r.rows.filter((x) => x.list);
    const placedOnRails = railRows.reduce((t, x) => t + x.list.length, 0);
    const fanCount = 0;   /* fan tidak lagi di backplate */
    assert.equal(placedOnRails, r.items.length - fanCount,
      'every rail entry must produce exactly one placed item');
    /* Panjang rail hanya boleh dihitung dari baris yang benar-benar berail. */
    const railed = railRows.filter((x) => x.needsRail).length;
    assert.equal(r.railLengthMm, railed * (r.W - E.ASSUMPTIONS.layout.pad * 2),
      'rail length must count only rows that carry a DIN rail');
  });
});

/* ════════════════════════════════════════════════════════════════════ */
describe('drive dipasang di backplate, bukan DIN rail', () => {
  /* Di panel sungguhan VFD dan servo amplifier dibaut ke plat belakang lewat
     lubang di heatsink-nya; tidak ada klip DIN di badannya. Menggambar rail di
     bawahnya salah, dan ikut menghitung panjang rail membuat BOM kelebihan. */
  test('vfd dan servo dideklarasikan mount plate', () => {
    assert.equal(E.COMPONENT_DB.vfd.mount, 'plate');
    assert.equal(E.COMPONENT_DB.servo.mount, 'plate');
  });

  test('baris drive tidak menggambar rail dan tidak menambah panjang rail', () => {
    const withDrives = R({ vfd: 3, servo: 2, motor: 5 });
    const drives = withDrives.rows.filter(
      (x) => x.list && x.list.every((t) => withDrives.specs[t].mount === 'plate'));
    assert.ok(drives.length > 0, 'harus ada baris drive');
    for (const row of drives) {
      assert.equal(row.needsRail, false);
      assert.ok(!/DIN RAIL/.test(row.name), `label masih menyebut rail: ${row.name}`);
      assert.match(row.name, /BACKPLATE/);
    }
    /* rail yang dibeli berkurang tepat sebanyak baris drive */
    const noDrives = R({ vfd: 0, servo: 0, motor: 0 });
    const span = withDrives.W - E.ASSUMPTIONS.layout.pad * 2;
    const railedRows = (r) => r.rows.filter((x) => x.list && x.needsRail).length;
    assert.equal(withDrives.railLengthMm, railedRows(withDrives) * span);
    assert.equal(noDrives.railLengthMm, railedRows(noDrives) * span);
  });

  test('baris ber-rail tetap menggambar rail', () => {
    const r = R();
    const control = r.rows.find((x) => x.list && x.list.includes('plc'));
    assert.equal(control.needsRail, true);
    assert.match(control.name, /DIN RAIL/);
  });

  test('komponen backplate mendapat pengencang di BOM, bukan potongan rail', () => {
    const r = R({ vfd: 3, servo: 2, motor: 5 });
    const plate = r.items.filter((i) => r.specs[i.type].mount === 'plate').length;
    const fast = r.bom.find((b) => b.pn === 'FASTENER-M6');
    assert.ok(fast, 'pengencang backplate hilang dari BOM');
    assert.equal(fast.qty, plate * 4);
    /* panel tanpa drive tidak perlu baut backplate sama sekali */
    const bare = R({ vfd: 0, servo: 0, motor: 0 });
    assert.equal(bare.bom.some((b) => b.pn === 'FASTENER-M6'), false);
  });
});

describe('invariant — wiring completeness (IEC 60204-1)', () => {
  forEachCase((r, c) => {
    const colours = new Set(Object.values(E.WIRE_COLOUR));
    for (const w of r.wiring) {
      assert.ok(colours.has(w.colour), `wire ${w.no} has colour "${w.colour}"`);
      assert.ok(w.from && w.to && w.size, `wire ${w.no} is incomplete`);
    }
    /* every PE conductor is green-yellow and vice versa */
    for (const w of r.wiring)
      assert.equal(/G\/Y/.test(w.size), w.colour === E.WIRE_COLOUR.pe,
        `wire ${w.no}: size "${w.size}" disagrees with colour "${w.colour}"`);
    /* the prototype had exactly one earth wire in the whole panel */
    const peCount = r.wiring.filter((w) => w.colour === E.WIRE_COLOUR.pe).length;
    assert.ok(peCount >= 4, `only ${peCount} PE conductors`);
    assert.ok(r.wiring.some((w) => /door/i.test(w.from)), 'door is not bonded');
    /* wire numbers are unique and sequential */
    const nos = r.wiring.map((w) => w.no);
    assert.equal(new Set(nos).size, nos.length, 'duplicate wire numbers');
  });

  test('DOL starters get coil circuits and motor earths', () => {
    const r = R({ vfd: 0, servo: 0, motor: 4 });
    assert.equal(r.dol, 4);
    for (let i = 1; i <= 4; i++) {
      assert.ok(r.wiring.some((w) => w.to === `K${i} A1 (coil +)`),
        `K${i} coil is not wired`);
      assert.ok(r.wiring.some((w) => w.from === `F${i} 95/96`),
        `F${i} trip contact is not wired back to the PLC`);
    }
    const motorPe = r.wiring.filter((w) => /Motor M\d+ PE/.test(w.from)).length;
    assert.equal(motorPe, 4, 'each DOL motor needs a PE conductor');
  });

  test('safety relay outputs actually go somewhere', () => {
    const r = R();
    assert.ok(r.wiring.some((w) => /13\/14/.test(w.from)), 'no stop-category path');
    assert.equal(r.wiring.filter((w) => /STO/.test(w.to)).length,
      r.cfg.vfd + r.cfg.servo, 'every drive needs an STO connection');
  });
});

describe('invariant — determinism and legacy configs', () => {
  test('same input, same output', () => {
    assert.deepEqual(R(), R());
  });
  test('a project saved before supplyV/ambientC existed still computes', () => {
    const legacy = { plc: 'Mitsubishi FX5U', di: 24, do_: 16, ai: 4, ao: 2,
                     vfd: 3, servo: 2, hmi: 2, motor: 6, valve: 5 };
    const n = E.normalizeCfg(legacy);
    assert.equal(n.supplyV, 400);
    assert.equal(n.ambientC, 30);
    assert.equal(n.cabW, 800);
    assert.doesNotThrow(() => E.compute(legacy));
  });
  test('normalizeCfg does not mutate its argument', () => {
    const input = { di: 8 };
    E.normalizeCfg(input);
    assert.deepEqual(input, { di: 8 });
  });
  test('garbage inputs are coerced, not propagated', () => {
    const r = E.compute({ di: 'twelve', do_: -5, vfd: null, ai: 2.7, supplyV: 'x' });
    assert.equal(r.cfg.di, 0);
    assert.equal(r.cfg.do_, 0);
    assert.equal(r.cfg.vfd, 0);
    assert.equal(r.cfg.ai, 3);
    assert.equal(r.cfg.supplyV, 400);
  });
  test('assumptions are overridable per call', () => {
    const tight = E.compute(cfg(), { psuMaxUtil: 0.4 });
    const loose = E.compute(cfg(), { psuMaxUtil: 0.95 });
    assert.ok(tight.psu.ratedA >= loose.psu.ratedA,
      'a tighter utilisation cap must not pick a smaller supply');
  });
});

describe('invariant — warnings replace silent failure', () => {
  test('too many expansion modules is an error, not a truncation', () => {
    const r = R({ di: 128, do_: 128, ai: 16, ao: 16 });
    assert.ok(r.warnings.some((w) => w.code === 'BUS_LIMIT' && w.level === 'error'));
  });
  test('fewer outputs than solenoids is an error', () => {
    const r = R({ do_: 2, valve: 10 });
    assert.ok(r.warnings.some((w) => w.code === 'DO_SHORT' && w.level === 'error'));
  });
  test('the 750 W servo frame gap at 400 V is disclosed', () => {
    const r = R({ supplyV: 400, servo: 1 });
    assert.ok(r.warnings.some((w) => w.code === 'DRIVE_FRAME'),
      'frame substitution not disclosed: ' + r.warnings.map(w=>w.code).join(','));
  });
  test('every warning is well formed', () => {
    MATRIX.forEach(({ c }) => {
      for (const w of R(c).warnings) {
        assert.ok(['info', 'warn', 'error'].includes(w.level));
        assert.ok(w.code && w.msg);
      }
    });
  });
});

/* ════════════════════════════════════════════════════════════════════ */
describe('library — component overrides reach the design', () => {
  test('a corrected dimension changes the layout, not just the card', () => {
    const base = R();
    const tall = E.compute(cfg(), { components: { plc: { h: 180 } } });
    const deep = E.compute(cfg(), { components: { plc: { d: 260 } } });
    const wide = E.compute(cfg(), { components: { plc: { w: 300 } } });
    assert.equal(tall.specs.plc.h, 180);
    assert.ok(tall.needH > base.needH, 'a taller component must need more height');
    assert.ok(deep.D > base.D, 'a deeper component must deepen the enclosure');
    assert.ok(wide.items.find((i) => i.type === 'plc').x >
              base.items.find((i) => i.type === 'plc').x,
      'a wider component must shift its own centre');
  });

  test('overridden components stay inside the backplate', () => {
    for (const patch of [{ w: 300 }, { h: 200 }, { w: 260, h: 160 }]) {
      const r = E.compute(cfg(), { components: { plc: patch } });
      if (r.overflow) continue;
      for (const it of r.items) {
        const d = r.specs[it.type];
        assert.ok(it.x + d.w / 2 <= r.W + 0.01, `${it.type} past the right edge`);
        assert.ok(it.y + d.h / 2 <= r.H + 0.01, `${it.type} past the bottom edge`);
      }
    }
  });

  test('library edits flow into the BOM part number and description', () => {
    const r = E.compute(cfg(), { components: {
      plc: { pn: 'FX5U-64MT/ES', desc: 'PLC CPU 32 DI / 32 DO', vendor: 'MEAU' } } });
    const line = r.bom.find((b) => b.pn === 'FX5U-64MT/ES');
    assert.ok(line, 'edited part number must reach the BOM');
    assert.equal(line.desc, 'PLC CPU 32 DI / 32 DO');
    assert.equal(line.vendor, 'MEAU');
  });

  test('overriding a selection-driven part warns that sizing is now pinned', () => {
    for (const k of E.SELECTION_DRIVEN) {
      const r = E.compute(cfg(), { components: { [k]: { w: 132 } } });
      if (!r.specs[k] || !r.items.some((i) => i.type === k)) continue;
      assert.equal(r.specs[k].w, 132, k + ' override not applied');
      assert.ok(r.warnings.some((w) => w.code === 'DIMS_PINNED'),
        'no pinning notice for ' + k);
    }
  });

  test('an override with no dimensions does not warn about pinning', () => {
    const r = E.compute(cfg(), { components: { psu: { vendor: 'Local supplier' } } });
    assert.ok(!r.warnings.some((w) => w.code === 'DIMS_PINNED'));
    assert.equal(r.specs.psu.vendor, 'Local supplier');
  });

  test('string dimensions from a form are coerced to numbers', () => {
    const r = E.compute(cfg(), { components: { plc: { w: '180', h: '95', powerW: '12' } } });
    assert.equal(r.specs.plc.w, 180);
    assert.equal(r.specs.plc.h, 95);
    assert.ok(Number.isFinite(r.needH));
  });
});

describe('library — custom components added to a project', () => {
  const CUSTOM = { components: { myrelay: {
    desc: 'My special relay', pn: 'XR-99', w: 30, h: 80, d: 70,
    powerW: 2, vendor: 'Acme', cat: 'Custom' } } };

  test('placed on the requested rail, in the requested quantity', () => {
    for (const rail of [1, 2, 3]) {
      const r = E.compute(cfg({ extras: [{ type: 'myrelay', qty: 3, rail }] }), CUSTOM);
      assert.equal(r.items.filter((i) => i.type === 'myrelay').length, 3);
      const row = r.rows.find((x) => x.list && x.list.includes('myrelay'));
      assert.ok(row, 'not placed on any rail');
      assert.ok(new RegExp('RAIL ' + rail).test(row.name),
        `expected rail ${rail}, got "${row.name}"`);
    }
  });

  test('reaches the BOM and the 24 V budget', () => {
    const plain = R();
    const r = E.compute(cfg({ extras: [{ type: 'myrelay', qty: 3, rail: 2 }] }), CUSTOM);
    const line = r.bom.find((b) => b.pn === 'XR-99');
    assert.ok(line && line.qty === 3, 'custom component missing from BOM');
    assert.equal(line.vendor, 'Acme');
    assert.ok(r.dcDetail.internal.some((x) => /My special relay/.test(x.name)));
    assert.equal(Math.round((r.dcLoad - plain.dcLoad) * 10) / 10, 6,
      '3 × 2 W must appear in the 24 V load');
    assert.ok(r.heat > plain.heat, 'internal gear must add heat');
  });

  test('an extra referencing a missing component errors instead of crashing', () => {
    const r = E.compute(cfg({ extras: [{ type: 'ghost', qty: 2, rail: 1 }] }));
    assert.ok(r.warnings.some((w) => w.code === 'UNKNOWN_COMPONENT' && w.level === 'error'));
    assert.ok(!r.items.some((i) => i.type === 'ghost'));
    assert.ok(Number.isFinite(r.heat) && Number.isFinite(r.needH));
  });

  test('malformed extras are normalised, not propagated', () => {
    const n = E.normalizeCfg({ extras: [
      { type: 'a', qty: 0, rail: 9 },      // qty floors at 1, rail falls back to 2
      { type: 'b', qty: '4', rail: '3' },  // strings coerced
      { type: 'c', place: 'door' },        // front-cover destination
      { type: 'd', place: 'nonsense' },    // unknown place falls back to plate
      { qty: 2 }, null, 'junk',            // no type → dropped
    ] });
    assert.deepEqual(n.extras, [
      { type: 'a', qty: 1, place: 'plate', rail: 2 },
      { type: 'b', qty: 4, place: 'plate', rail: 3 },
      { type: 'c', qty: 1, place: 'door', rail: 2 },
      { type: 'd', qty: 1, place: 'plate', rail: 2 },
    ]);
  });

  test('an extra saved before the front cover existed defaults to the plate', () => {
    const n = E.normalizeCfg({ extras: [{ type: 'x', qty: 2, rail: 1 }] });
    assert.equal(n.extras[0].place, 'plate');
  });

  test('extras survive a round trip through normalizeCfg', () => {
    const c = cfg({ extras: [{ type: 'myrelay', qty: 2, place: 'plate', rail: 1 },
                             { type: 'myrelay', qty: 1, place: 'door', rail: 2 }] });
    assert.deepEqual(E.normalizeCfg(E.normalizeCfg(c)).extras, c.extras);
  });

  test('every invariant still holds with a custom component in the panel', () => {
    const r = E.compute(cfg({ extras: [{ type: 'myrelay', qty: 6, rail: 2 }] }), CUSTOM);
    const bad = [];
    (function scan(o, p) {
      if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(p); return; }
      if (o && typeof o === 'object') Object.keys(o).forEach((k) => scan(o[k], p + '.' + k));
    })(r, 'R');
    assert.deepEqual(bad, []);
    assert.ok(r.util <= E.ASSUMPTIONS.psuMaxUtil * 100 + 1e-9);
    assert.equal(r.side.items.filter((i) => i.type === 'fan').length, r.thermal.fans);
    for (const it of r.items) assert.ok(r.specs[it.type], 'unknown type ' + it.type);
  });
});

describe('library — resolveDb', () => {
  test('leaves the built-in database untouched', () => {
    const before = JSON.stringify(E.COMPONENT_DB);
    E.resolveDb({ plc: { w: 999 }, brand_new: { desc: 'X' } });
    assert.equal(JSON.stringify(E.COMPONENT_DB), before,
      'resolveDb must not mutate COMPONENT_DB');
  });
  test('a new key inherits the blank template', () => {
    const db = E.resolveDb({ thing: { desc: 'Thing', w: 20 } });
    assert.equal(db.thing.w, 20);
    assert.equal(db.thing.mount, E.BLANK_COMPONENT.mount);
    assert.equal(db.thing.cat, E.BLANK_COMPONENT.cat);
  });
});

/* ════════════════════════════════════════════════════════════════════ */
describe('panel size — catalogue H×W vs automatic', () => {
  test('the offered sizes are the ones the designer lists, height first', () => {
    assert.deepEqual(E.STD_SIZES.map((s) => s.h + 'x' + s.w),
      ['400x300', '500x400', '600x400', '800x600', '1000x800', '1200x800']);
  });

  test('every catalogue size is portrait — taller than wide', () => {
    for (const s of E.STD_SIZES)
      assert.ok(s.h >= s.w, `${s.h}×${s.w} is landscape`);
  });

  test('automatic sizing never returns a landscape panel either', () => {
    const machines = [
      { di: 4, do_: 4, ai: 0, ao: 0, vfd: 0, servo: 0, hmi: 0, motor: 1, valve: 1 },
      { di: 8, do_: 8, ai: 0, ao: 0, vfd: 0, servo: 0, hmi: 0, motor: 2, valve: 2 },
      { plc: E.NO_PLC, di: 0, do_: 0, ai: 0, ao: 0, vfd: 0, servo: 0, hmi: 0, motor: 3, valve: 0 },
      {},
    ];
    for (const m of machines)
      for (const cabW of E.STD_WIDTHS) {
        const r = R(Object.assign({ cabW, cabH: 0 }, m));
        assert.ok(r.H >= r.W,
          `auto gave ${r.W} wide × ${r.H} tall (landscape) for cabW=${cabW}`);
        assert.ok(r.H >= r.needH, 'portrait enforcement must not cut content');
        assert.ok(E.STD_HEIGHTS.includes(r.H) || r.dims.nonStandardH);
      }
  });

  test('a chosen height is honoured exactly, not rounded', () => {
    for (const s of E.STD_SIZES) {
      const r = R({ cabW: s.w, cabH: s.h });
      assert.equal(r.W, s.w);
      assert.equal(r.H, s.h, `${s.w}×${s.h} was changed to ${r.H}`);
      assert.equal(r.dims.fixedH, true);
    }
  });

  test('cabH 0 keeps automatic sizing from the layout', () => {
    const r = R({ cabH: 0 });
    assert.equal(r.dims.fixedH, false);
    assert.ok(E.STD_HEIGHTS.includes(r.H));
    assert.ok(r.H >= r.needH);
  });

  test('a panel too small for its contents is an error, not a silent overflow', () => {
    const r = R({ cabW: 400, cabH: 300 });
    assert.equal(r.H, 300, 'the chosen size must still be reported as chosen');
    const w = r.warnings.find((x) => x.code === 'PANEL_TOO_SMALL');
    assert.ok(w && w.level === 'error', 'no PANEL_TOO_SMALL error');
    assert.match(w.msg, /needs \d+ mm/);
    assert.ok(Number.isFinite(r.heat), 'must still compute');
  });

  test('a size that genuinely fits raises no error', () => {
    const small = { di: 4, do_: 4, ai: 0, ao: 0, vfd: 0, servo: 0,
                    hmi: 0, motor: 1, valve: 1 };
    const r = R(Object.assign({ cabW: 800, cabH: 600 }, small));
    assert.ok(r.needH <= 600, 'fixture no longer fits: needs ' + Math.round(r.needH));
    assert.ok(!r.warnings.some((x) => /TOO_SMALL/.test(x.code)),
      'false positive: ' + JSON.stringify(r.warnings.map((x) => x.code)));
  });

  test('a narrower panel needs more height, because rails wrap', () => {
    const small = { di: 4, do_: 4, ai: 0, ao: 0, vfd: 0, servo: 0,
                    hmi: 0, motor: 1, valve: 1 };
    const narrow = R(Object.assign({ cabW: 400, cabH: 0 }, small));
    const wide = R(Object.assign({ cabW: 800, cabH: 0 }, small));
    assert.ok(narrow.needH > wide.needH,
      `400 mm wide needed ${Math.round(narrow.needH)}, 800 mm needed ${Math.round(wide.needH)}`);
  });

  test('a fixed height still drives the thermal surface', () => {
    const short = R({ cabW: 800, cabH: 600 });
    const tall = R({ cabW: 800, cabH: 800 });
    assert.ok(tall.thermal.Ae > short.thermal.Ae);
    assert.ok(tall.thermal.naturalDT < short.thermal.naturalDT);
  });
});

describe('front cover layout', () => {
  test('generates the operator devices IEC 60204-1 expects', () => {
    const r = R();
    const types = r.door.items.map((i) => i.type);
    for (const need of ['estop', 'disconnect', 'pb_start', 'pb_stop', 'pb_reset',
                        'sel_auto', 'lamp_pwr', 'lamp_run', 'lamp_flt'])
      assert.ok(types.includes(need), 'front cover is missing ' + need);
    assert.equal(types.filter((t) => t === 'estop').length, 1, 'exactly one E-stop');
  });

  test('HMI count follows the configuration', () => {
    for (const hmi of [0, 1, 2, 4]) {
      const r = R({ hmi });
      assert.equal(r.door.items.filter((i) => i.type === 'hmi').length, hmi);
    }
  });

  test('one run lamp per DOL starter plus a system lamp', () => {
    for (const motor of [0, 5, 6, 9]) {
      const r = R({ motor });
      assert.equal(r.door.items.filter((i) => i.type === 'lamp_run').length,
        1 + r.dol, `motor=${motor}`);
    }
  });

  test('every door device is inside the door, clear of the margins', () => {
    for (const s of E.STD_SIZES.concat([{ w: 800, h: 0 }])) {
      const r = R({ cabW: s.w, cabH: s.h });
      if (!r.door.fits) continue;
      const M = r.door.margin;
      for (const it of r.door.items) {
        const d = r.specs[it.type];
        assert.ok(it.x - d.w / 2 >= M - 0.01, `${it.type} inside the left margin`);
        assert.ok(it.x + d.w / 2 <= r.W - M + 0.01 || it.type === 'estop',
          `${it.type} past the right margin`);
        assert.ok(it.y - d.h / 2 >= M - 0.01, `${it.type} inside the top margin`);
        assert.ok(it.y + d.h / 2 <= r.H - 0.01, `${it.type} past the bottom edge`);
      }
    }
  });

  test('nothing overlaps the reserved E-stop block', () => {
    const r = R({ hmi: 4 });
    const est = r.door.items.find((i) => i.type === 'estop');
    const e = r.specs.estop;
    const box = { x1: est.x - e.w / 2, x2: est.x + e.w / 2,
                  y1: est.y - e.h / 2, y2: est.y + e.h / 2 };
    for (const it of r.door.items) {
      if (it.type === 'estop') continue;
      const d = r.specs[it.type];
      const overlap = it.x + d.w / 2 > box.x1 && it.x - d.w / 2 < box.x2 &&
                      it.y + d.h / 2 > box.y1 && it.y - d.h / 2 < box.y2;
      assert.ok(!overlap, it.type + ' overlaps the E-stop');
    }
  });

  test('every device gets a stable id and a fixed tag', () => {
    const r = R();
    const byTag = {};
    for (const it of r.door.items) byTag[it.type] = it.tag;
    assert.equal(byTag.estop, 'S1');
    assert.equal(byTag.sel_auto, 'S2');
    assert.equal(byTag.pb_start, 'S3');
    assert.equal(byTag.pb_stop, 'S4');
    assert.equal(byTag.pb_reset, 'S5');
    assert.equal(byTag.lamp_pwr, 'H1');
    assert.equal(byTag.lamp_flt, 'H3');
    assert.equal(byTag.disconnect, 'Q1');
    /* ids are unique and encode the ordinal */
    const ids = r.door.items.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('estop#1'));
    assert.ok(ids.includes('hmi#2'), 'second HMI should be hmi#2');
  });

  test('tags stay put when unrelated devices change', () => {
    const a = R({ hmi: 1 });
    const b = R({ hmi: 3, motor: 9 });
    const tagOf = (r, t) => r.door.items.find((i) => i.type === t).tag;
    for (const t of ['estop', 'pb_start', 'pb_stop', 'lamp_pwr', 'lamp_flt'])
      assert.equal(tagOf(a, t), tagOf(b, t), t + ' tag moved');
  });

  test('backplate components are designated too', () => {
    const r = R();
    const byType = {};
    for (const it of r.items) {
      const base = r.specs[it.type].baseKey || it.type;
      if (!byType[base]) byType[base] = it.tag;
    }
    assert.equal(byType.mccb, 'Q1');
    assert.equal(byType.psu, 'G1');
    assert.equal(byType.plc, 'A1');
    assert.match(byType.contactor, /^K\d+$/);
    assert.match(byType.vfd, /^T\d+$/);
    const ids = r.items.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate backplate ids');
  });

  test('a door too small for its devices is an error', () => {
    const r = R({ cabW: 400, cabH: 300, hmi: 4 });
    assert.ok(r.warnings.some((w) => w.code === 'DOOR_TOO_SMALL' && w.level === 'error'));
  });

  test('door devices reach the BOM, flagged as door-mounted', () => {
    const r = R();
    for (const pn of ['XB4BS8445', 'GS2107-WTBD', 'XB4BA31', 'XB4BA42', 'XB4BVM3'])
      assert.ok(r.bom.some((b) => b.pn === pn), 'BOM is missing ' + pn);
    const estop = r.bom.find((b) => b.pn === 'XB4BS8445');
    assert.equal(estop.qty, 1);
    assert.equal(estop.door, true);
    assert.ok(r.bom.some((b) => b.pn === 'LEGEND-PLATE'), 'no legend plates');
  });

  test('door devices are wired', () => {
    const r = R();
    for (const re of [/S3 START/, /S4 STOP/, /S5 RESET/, /H1 POWER/, /H2 RUN/,
                      /AUTO\/OFF\/MAN|S2 AUTO/, /disconnect handle/])
      assert.ok(r.wiring.some((w) => re.test(w.from) || re.test(w.to)),
        'no wiring for ' + re);
  });

  test('pilot lamps are charged to the 24 V budget once', () => {
    const r = R();
    const line = r.dcDetail.internal.find((x) => /Pilot lamps/.test(x.name));
    assert.ok(line, 'lamps missing from the 24 V budget');
    const lamps = r.door.items.filter((i) => /^lamp_/.test(i.type)).length;
    assert.equal(line.w, lamps * E.COMPONENT_DB.lamp_pwr.powerW);
  });

  test('HMI power is not double-counted between door and budget', () => {
    const r = R({ hmi: 2 });
    const hmiLines = r.dcDetail.internal.filter((x) => /HMI/.test(x.name));
    assert.equal(hmiLines.length, 1, 'HMI counted more than once');
    assert.equal(hmiLines[0].w, 30);
  });
});

describe('library — adding a component to the front cover', () => {
  const METER = { components: { meter: {
    desc: 'Energy meter 96×96', pn: 'EM-96', w: 96, h: 96, d: 60,
    powerW: 3, vendor: 'Local', cat: 'Control', mount: 'door' } } };

  test('place:door lands on the cover, not on a rail', () => {
    const r = E.compute(cfg({ extras: [{ type: 'meter', qty: 2, place: 'door' }] }), METER);
    assert.equal(r.door.items.filter((i) => i.type === 'meter').length, 2);
    assert.equal(r.items.filter((i) => i.type === 'meter').length, 0,
      'a front-cover device must not consume backplate space');
    assert.ok(r.door.zones.some((z) => /ADDED FROM LIBRARY/.test(z.label)));
  });

  test('place:plate still lands on the requested rail', () => {
    const r = E.compute(cfg({ extras: [{ type: 'meter', qty: 2, place: 'plate', rail: 1 }] }), METER);
    assert.equal(r.items.filter((i) => i.type === 'meter').length, 2);
    assert.equal(r.door.items.filter((i) => i.type === 'meter').length, 0);
  });

  test('the same component can go to both destinations at once', () => {
    const r = E.compute(cfg({ extras: [
      { type: 'meter', qty: 1, place: 'door' },
      { type: 'meter', qty: 3, place: 'plate', rail: 2 },
    ] }), METER);
    assert.equal(r.door.items.filter((i) => i.type === 'meter').length, 1);
    assert.equal(r.items.filter((i) => i.type === 'meter').length, 3);
    const line = r.bom.find((b) => b.pn === 'EM-96');
    assert.equal(line.qty, 4, 'BOM must total both destinations');
  });

  test('a front-cover extra reaches the BOM, budget and is draggable', () => {
    const plain = R();
    const r = E.compute(cfg({ extras: [{ type: 'meter', qty: 2, place: 'door' }] }), METER);
    const line = r.bom.find((b) => b.pn === 'EM-96');
    assert.ok(line && line.qty === 2);
    assert.equal(line.door, true, 'should be flagged door-mounted');
    assert.equal(Math.round(r.dcLoad - plain.dcLoad), 6, '2 × 3 W not in the 24 V load');
    /* stable ids mean manual placement works on them too */
    const ids = r.door.items.filter((i) => i.type === 'meter').map((i) => i.id);
    assert.deepEqual(ids, ['meter#1', 'meter#2']);
    const moved = E.compute(cfg({ extras: [{ type: 'meter', qty: 2, place: 'door' }],
                                  doorPos: { 'meter#1': { x: 400, y: 700 } } }), METER);
    const m = moved.door.items.find((i) => i.id === 'meter#1');
    assert.equal(m.x, 400);
    assert.equal(m.manual, true);
  });

  test('a front-cover extra too big for the door is reported', () => {
    const big = { components: { slab: { desc: 'Huge slab', pn: 'SLAB',
      w: 900, h: 900, d: 40, mount: 'door' } } };
    const r = E.compute(cfg({ cabW: 300, cabH: 400,
                              extras: [{ type: 'slab', qty: 1, place: 'door' }] }), big);
    assert.ok(r.warnings.some((w) => w.code === 'DOOR_TOO_SMALL'));
    assert.ok(Number.isFinite(r.door.neededH));
  });

  test('the front-cover catalogue is broad enough to build a real door', () => {
    const door = Object.keys(E.COMPONENT_DB)
      .filter((k) => E.COMPONENT_DB[k].mount === 'door' && k !== 'fan');
    assert.ok(door.length >= 30,
      `only ${door.length} front-cover components in the library`);
    assert.deepEqual(E.DOOR_KEYS.slice().sort(), door.slice().sort(),
      'DOOR_KEYS must be derived from the database');
    /* the kinds an operator door actually needs */
    const descs = door.map((k) => E.COMPONENT_DB[k].desc.toLowerCase()).join(' | ');
    for (const kind of ['pushbutton', 'illuminated', 'mushroom', 'emergency stop',
                        'selector', 'key selector', 'pilot lamp', 'potentiometer',
                        'buzzer', 'beacon', 'hmi', 'ammeter', 'voltmeter',
                        'energy meter', 'hour run meter', 'temperature controller',
                        'door lock', 'window', 'socket', 'rj45', 'usb'])
      assert.ok(descs.includes(kind), 'no front-cover device for: ' + kind);
  });

  test('every door component is complete and physically sane', () => {
    for (const k of E.DOOR_KEYS) {
      const d = E.COMPONENT_DB[k];
      assert.ok(d.desc && d.pn, k + ' missing desc or part number');
      assert.ok(d.w > 0 && d.h > 0 && d.d > 0, k + ' has a zero dimension');
      assert.ok(d.w <= 400 && d.h <= 400, k + ' is implausibly large for a door');
      assert.ok(Number.isFinite(d.powerW) && d.powerW >= 0, k + ' bad powerW');
      assert.ok(d.cat && d.color && d.bg, k + ' missing display fields');
    }
  });

  test('placeholder part numbers are flagged generic, and reach the BOM flagged', () => {
    const generic = E.DOOR_KEYS.filter((k) => E.COMPONENT_DB[k].generic);
    assert.ok(generic.length > 0, 'nothing marked generic');
    for (const k of generic)
      assert.equal(E.COMPONENT_DB[k].vendor, 'to be specified',
        k + ' is generic but names a vendor');
    const r = E.compute(cfg({ extras: [{ type: generic[0], qty: 1, place: 'door' }] }));
    const line = r.bom.find((b) => b.pn === E.COMPONENT_DB[generic[0]].pn);
    assert.ok(line && line.generic === true, 'generic flag lost on the way to the BOM');
  });

  test('every component with a real vendor is NOT flagged generic', () => {
    for (const k of Object.keys(E.COMPONENT_DB)) {
      const d = E.COMPONENT_DB[k];
      if (d.generic) continue;
      assert.notEqual(d.vendor, 'to be specified',
        k + ' has a placeholder vendor but is not flagged generic');
    }
  });
});

describe('PLC catalogue — dropdown and library are one source', () => {
  test('every isPlc component is offered as a model', () => {
    const models = E.plcModels();
    const dbPlc = Object.keys(E.COMPONENT_DB).filter((k) => E.COMPONENT_DB[k].isPlc);
    assert.equal(models.length, dbPlc.length);
    assert.ok(models.length >= 10, `only ${models.length} CPU models`);
    for (const m of models) {
      assert.ok(m.key && m.name && m.pn && m.vendor, 'incomplete model ' + m.key);
      assert.ok(m.di > 0 && m.do_ > 0, m.key + ' has no built-in I/O');
      assert.ok(m.maxExp > 0, m.key + ' has no expansion limit');
    }
    /* more than one vendor, so the dropdown is genuinely multi-brand */
    assert.ok(new Set(models.map((m) => m.vendor)).size >= 5);
  });

  test('choosing a CPU changes the part number, footprint and 24 V load', () => {
    const small = R({ plc: 'plc_s71212' });
    const big = R({ plc: 'plc_fx5u80' });
    assert.equal(small.cpu.pn, '6ES7212-1AE40-0XB0');
    assert.equal(big.cpu.pn, 'FX5U-80MT/ES');
    assert.ok(big.specs.plc_fx5u80.w > small.specs.plc_s71212.w);
    assert.ok(r_bom(big, 'FX5U-80MT/ES'), 'CPU not in BOM');
    assert.ok(!r_bom(big, '6ES7212-1AE40-0XB0'), 'wrong CPU in BOM');
    assert.notEqual(small.dcLoad, big.dcLoad, 'CPU power draw not applied');
  });

  test('built-in I/O reduces the expansion modules bought', () => {
    /* 24 DI: a 16 DI CPU needs one module, a 32 DI CPU needs none */
    assert.equal(R({ plc: 'plc', di: 24, do_: 0, ai: 0, ao: 0 }).diExtra, 1);
    assert.equal(R({ plc: 'plc_fx5u64', di: 24, do_: 0, ai: 0, ao: 0 }).diExtra, 0);
    assert.equal(R({ plc: 'plc_fx5u80', di: 40, do_: 0, ai: 0, ao: 0 }).diExtra, 0);
    assert.equal(R({ plc: 'plc_s71212', di: 24, do_: 0, ai: 0, ao: 0 }).diExtra, 1);
  });

  test('each CPU enforces its own expansion limit', () => {
    const omron = R({ plc: 'plc_cp1e30', di: 128, do_: 128, ai: 16, ao: 16 });
    const fx5u = R({ plc: 'plc', di: 128, do_: 128, ai: 16, ao: 16 });
    const msg = omron.warnings.find((w) => w.code === 'BUS_LIMIT');
    assert.ok(msg, 'Omron limit of 3 not enforced');
    assert.match(msg.msg, /batas 3/);
    assert.ok(fx5u.warnings.some((w) => w.code === 'BUS_LIMIT'));
  });

  test('non-Mitsubishi CPUs use generic expansion, and say so', () => {
    const r = R({ plc: 'plc_s71214', di: 64 });
    assert.equal(r.diExtra > 0, true);
    assert.ok(r.items.some((i) => i.type === 'exp_di16'));
    assert.ok(r.warnings.some((w) => w.code === 'EXP_GENERIC'),
      'generic expansion modules must be disclosed');
    /* a Mitsubishi CPU uses the real FX5 modules and does not warn */
    const mit = R({ plc: 'plc', di: 64 });
    assert.ok(mit.items.some((i) => i.type === 'di16'));
    assert.ok(!mit.warnings.some((w) => w.code === 'EXP_GENERIC'));
  });

  test('a CPU added through the library shows up as a model', () => {
    const patch = { my_plc: { isPlc: true, plcName: 'Panasonic FP0H',
      pn: 'AFP0HC32T', vendor: 'Panasonic', desc: 'PLC FP0H 16 DI / 16 DO',
      w: 100, h: 90, d: 70, powerW: 15, builtinDi: 16, builtinDo: 16, maxExp: 3,
      cat: 'Control', mount: 'rail' } };
    const models = E.plcModels(patch);
    assert.ok(models.some((m) => m.key === 'my_plc' && m.vendor === 'Panasonic'),
      'library CPU missing from the dropdown source');
    const r = E.compute(cfg({ plc: 'my_plc', di: 24 }), { components: patch });
    assert.equal(r.cpu.pn, 'AFP0HC32T');
    assert.equal(r.diExtra, 1);
    assert.ok(r_bom(r, 'AFP0HC32T'));
    assert.ok(r.items.some((i) => i.type === 'my_plc'));
  });

  test('a missing or blank plc means "not set", not "no PLC"', () => {
    /* Sebuah cfg tanpa field plc pernah diam-diam jadi panel tanpa CPU, dan
       nilainya berubah lagi setelah round-trip JSON (undo/simpan) — dua desain
       berbeda dari satu proyek yang sama. */
    for (const raw of [{}, { plc: undefined }, { plc: '' }, { plc: null }, { plc: 0 }]) {
      const n = E.normalizeCfg(raw);
      assert.equal(n.plc, E.DEFAULT_CFG.plc, 'plc not defaulted for ' + JSON.stringify(raw));
      assert.equal(n.hasPlc, true, 'blank plc must not mean No PLC');
    }
    /* hanya 'none' yang berarti tanpa CPU */
    assert.equal(E.normalizeCfg({ plc: E.NO_PLC }).hasPlc, false);
  });

  test('a config survives a JSON round trip unchanged', () => {
    /* undo/redo dan penyimpanan memakai JSON.stringify — hasilnya harus
       menghasilkan desain yang identik, bukan CPU atau PSU yang berbeda */
    for (const over of [{}, { plc: E.NO_PLC }, { plc: 'plc_s71214' }, { vfd: 0, servo: 0 }]) {
      const a = R(over);
      const b = E.compute(JSON.parse(JSON.stringify(a.cfg)));
      assert.equal(b.cpu ? b.cpu.pn : null, a.cpu ? a.cpu.pn : null, 'CPU changed');
      assert.equal(b.psu.pn, a.psu.pn, 'PSU changed');
      assert.deepEqual([b.W, b.H, b.D], [a.W, a.H, a.D], 'enclosure changed');
      assert.equal(b.items.length, a.items.length, 'component count changed');
      assert.equal(b.bom.length, a.bom.length, 'BOM changed');
    }
  });

  test('legacy cfg.plc display names are mapped to component keys', () => {
    assert.equal(E.normalizeCfg({ plc: 'Mitsubishi FX5U' }).plc, 'plc');
    assert.equal(E.normalizeCfg({ plc: 'Mitsubishi FX5UJ' }).plc, 'plc_fx5uj40');
    assert.equal(E.normalizeCfg({ plc: 'none' }).hasPlc, false);
    assert.doesNotThrow(() => E.compute({ plc: 'Mitsubishi FX5U', di: 24 }));
  });

  test('an unknown CPU is an error, and the panel still computes', () => {
    const r = R({ plc: 'tidak_ada' });
    assert.ok(r.warnings.some((w) => w.code === 'PLC_UNKNOWN' && w.level === 'error'));
    assert.equal(r.hasPlc, false);
    assert.ok(Number.isFinite(r.heat));
  });

  test('pointing cfg.plc at a non-PLC component is rejected', () => {
    const r = R({ plc: 'mccb' });
    assert.ok(r.warnings.some((w) => w.code === 'PLC_UNKNOWN'));
    assert.equal(r.items.filter((i) => i.type === 'mccb').length, 1,
      'the breaker must still be placed exactly once');
  });
});

describe('terminal blocks — rail 4', () => {
  const TB = [{ type: 'tb_6', qty: 28, place: 'plate', rail: 4 },
              { type: 'tb_2_5', qty: 52, place: 'plate', rail: 4 },
              { type: 'tb_pe', qty: 12, place: 'plate', rail: 4 }];

  test('the library carries a real range of terminal types', () => {
    const tb = Object.keys(E.COMPONENT_DB).filter((k) => E.COMPONENT_DB[k].cat === 'Terminals');
    assert.ok(tb.length >= 10, `only ${tb.length} terminal types`);
    const descs = tb.map((k) => E.COMPONENT_DB[k].desc.toLowerCase()).join(' | ');
    for (const kind of ['2,5 mm²', '4 mm²', '6 mm²', '10 mm²', '16 mm²',
                        'ground pe', 'netral', 'double-level', 'berfuse',
                        'disconnect', 'end clamp', 'partition'])
      assert.ok(descs.includes(kind), 'no terminal type for: ' + kind);
    /* pitch per pole must be plausible, not a guessed 45 mm */
    for (const k of tb) assert.ok(E.COMPONENT_DB[k].w <= 13, k + ' pitch looks wrong');
  });

  test('placed terminals get their own rail and appear in the drawing', () => {
    const r = R({ extras: TB });
    const row = r.rows.find((x) => x.list && /RAIL 4/.test(x.name));
    assert.ok(row, 'no terminal rail emitted');
    assert.equal(r.items.filter((i) => /^tb_/.test(i.type)).length, 92);
  });

  test('the decorative band is used only until terminals are chosen', () => {
    assert.ok(R().rows.some((x) => x.kind === 'tstrip'), 'band missing by default');
    assert.ok(!R({ extras: TB }).rows.some((x) => x.kind === 'tstrip'),
      'band and rail 4 must not both appear');
  });

  test('itemised terminals replace the estimate — no double counting', () => {
    const auto = R();
    const itemised = R({ extras: TB });
    const qty = (r, pn) => (r.bom.find((b) => b.pn === pn) || {}).qty || 0;
    /* the estimate is present by default */
    assert.ok(qty(auto, 'UT 6') > 0 && qty(auto, 'UT 2,5') > 0);
    /* with rail 4 the counts come from what was placed, once */
    assert.equal(itemised.bom.filter((b) => b.pn === 'UT 6').length, 1,
      'UT 6 appears twice — estimate not suppressed');
    assert.equal(qty(itemised, 'UT 6'), 28);
    assert.equal(qty(itemised, 'UT 2,5 (spare)'), 0, 'spare estimate still added');
  });

  test('placing fewer terminals than the design needs is flagged', () => {
    const short = R({ extras: [{ type: 'tb_2_5', qty: 10, place: 'plate', rail: 4 }] });
    const w = short.warnings.find((x) => x.code === 'TERMINALS_SHORT');
    assert.ok(w, 'shortage not reported');
    assert.match(w.msg, /butuh \d+ titik/);
    /* and no warning once enough are placed */
    assert.ok(!R({ extras: TB }).warnings.some((x) => x.code === 'TERMINALS_SHORT'));
  });

  test('rail 4 keeps every invariant', () => {
    const r = R({ extras: TB });
    assert.equal(r.side.items.filter((i) => i.type === 'fan').length, r.thermal.fans);
    for (const it of r.items) assert.ok(r.specs[it.type], 'unknown ' + it.type);
    const ids = r.items.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
    if (!r.overflow) for (const it of r.items) {
      const d = r.specs[it.type];
      assert.ok(it.x + d.w / 2 <= r.W + 0.01, it.type + ' past the right edge');
    }
  });
});

describe('backplate — manual horizontal placement', () => {
  const rowsOf = (r) => r.railRows;

  test('X is honoured and Y snaps to the chosen rail', () => {
    const base = R();
    const rows = rowsOf(base);
    const r = R({ platePos: { 'psu#1': { x: 600, row: rows[1] } } });
    const it = r.items.find((i) => i.id === 'psu#1');
    assert.equal(it.x, 600, 'X not applied');
    assert.equal(it.y, r.rows[rows[1]].railY,
      'Y must snap to the rail centreline, never float between rails');
    assert.equal(it.manual, true);
  });

  test('only the moved component is pinned', () => {
    const base = R();
    const r = R({ platePos: { 'mccb#1': { x: 400 } } });
    assert.deepEqual(r.manualPlate, ['mccb#1']);
    for (const it of r.items) {
      if (it.id === 'mccb#1') continue;
      const a = base.items.find((x) => x.id === it.id);
      assert.equal(it.x, a.x, it.id + ' drifted');
    }
  });

  test('zero gap between components is allowed', () => {
    const base = R();
    const mccb = base.items.find((i) => i.id === 'mccb#1');
    const w = base.specs.mccb.w, w2 = base.specs.spd.w;
    /* butt the SPD straight up against the breaker */
    const x = mccb.x + w / 2 + w2 / 2;
    const r = R({ platePos: { 'spd#1': { x } } });
    assert.equal(r.items.find((i) => i.id === 'spd#1').x, x);
    assert.ok(!r.warnings.some((wr) => wr.code === 'PLATE_OVERLAP'),
      'touching is not overlapping — must not warn');
  });

  test('genuine overlap is reported with both tags', () => {
    const r = R({ platePos: { 'psu#1': { x: 100, row: 0 } } });
    assert.ok(r.overlaps.length > 0, 'overlap not detected');
    const w = r.warnings.find((x) => x.code === 'PLATE_OVERLAP');
    assert.ok(w && w.level === 'warn');
    assert.match(w.msg, /G1/);
  });

  test('an overload follows the contactor it hangs under', () => {
    const base = R({ motor: 6, vfd: 0, servo: 0 });
    const kId = base.items.find((i) => (base.specs[i.type].baseKey) === 'contactor').id;
    const fId = base.items.find((i) => (base.specs[i.type].baseKey) === 'overload').id;
    const r = R({ motor: 6, vfd: 0, servo: 0, platePos: { [kId]: { x: 500 } } });
    const k = r.items.find((i) => i.id === kId);
    const f = r.items.find((i) => i.id === fId);
    assert.equal(f.x, k.x, 'overload left behind when the contactor moved');
    assert.ok(f.y > k.y, 'overload must sit below its contactor');
  });

  test('a stale row index falls back to automatic', () => {
    const r = R({ platePos: { 'psu#1': { x: 300, row: 99 } } });
    const auto = R();
    assert.equal(r.items.find((i) => i.id === 'psu#1').x, 300);
    assert.equal(r.items.find((i) => i.id === 'psu#1').y,
      auto.items.find((i) => i.id === 'psu#1').y, 'Y should stay automatic');
  });

  test('malformed platePos entries are dropped', () => {
    const n = E.normalizeCfg({ platePos: {
      'a#1': { x: 'abc' }, 'b#1': { row: 1.5 }, 'c#1': { x: 120, row: 2 }, 'd#1': null } });
    assert.deepEqual(Object.keys(n.platePos), ['c#1']);
    assert.deepEqual(n.platePos['c#1'], { x: 120, row: 2 });
  });

  test('manual placement does not change the BOM', () => {
    const auto = R(), moved = R({ platePos: { 'psu#1': { x: 600 } } });
    assert.deepEqual(moved.bom.map((b) => b.pn + ':' + b.qty),
                     auto.bom.map((b) => b.pn + ':' + b.qty));
  });
});

/* helper: cari baris BOM berdasarkan part number */
function r_bom(r, pn) { return r.bom.find((b) => b.pn === pn); }

describe('library exchange — export', () => {
  const patch = { my_relay: { desc: 'Relay khusus', pn: 'XR-9', w: 20, h: 80, d: 70,
    powerW: 2, vendor: 'Acme', cat: 'Switching', mount: 'rail' } };

  test('produces a versioned, self-describing file', () => {
    const pkg = E.exportLibrary(patch, ['my_relay'], { now: '2026-07-28T00:00:00Z' });
    assert.equal(pkg.format, 'panel-builder-library');
    assert.equal(pkg.version, E.LIB_VERSION);
    assert.equal(pkg.exported, '2026-07-28T00:00:00Z');
    assert.equal(pkg.count, 1);
    assert.ok(JSON.parse(JSON.stringify(pkg)), 'must survive JSON round trip');
  });

  test('exports a complete snapshot, not just the override', () => {
    /* the receiving app may have different built-ins, so a diff would be useless */
    const pkg = E.exportLibrary({ mccb: { pn: 'CUSTOM-99' } }, ['mccb']);
    const m = pkg.components.mccb;
    assert.equal(m.pn, 'CUSTOM-99', 'override must win');
    assert.equal(m.w, E.COMPONENT_DB.mccb.w, 'unchanged fields must still be present');
    assert.equal(m.cat, E.COMPONENT_DB.mccb.cat);
    assert.ok(m.desc && m.mount);
  });

  test('only the requested components are included', () => {
    const pkg = E.exportLibrary(patch, ['my_relay', 'mccb', 'tidak_ada']);
    assert.deepEqual(Object.keys(pkg.components).sort(), ['mccb', 'my_relay']);
  });

  test('images are opt-in', () => {
    const withImg = E.exportLibrary(patch, ['my_relay'],
      { images: true, imageMap: { my_relay: 'data:image/png;base64,AAA' } });
    assert.deepEqual(Object.keys(withImg.images), ['my_relay']);
    const without = E.exportLibrary({ my_relay: Object.assign({ hasImage: true,
      imgVersion: 7 }, patch.my_relay) }, ['my_relay'], { images: false });
    assert.deepEqual(without.images, {});
    assert.equal(without.components.my_relay.hasImage, undefined,
      'the image flag must not survive an image-less export');
  });
});

describe('library exchange — import', () => {
  const good = (over) => Object.assign({
    format: 'panel-builder-library', version: 1,
    components: { imported: { desc: 'Imported thing', pn: 'IMP-1',
      w: 30, h: 60, d: 50, cat: 'Switching', mount: 'rail' } } }, over || {});

  test('a well-formed file is accepted and counted', () => {
    const v = E.validateLibraryFile(good(), {});
    assert.equal(v.ok, true);
    assert.equal(v.total, 1);
    assert.equal(v.isNew, 1);
    assert.equal(v.overwrite, 0);
  });

  test('overwrites are counted against built-ins and existing overrides', () => {
    const f = good({ components: {
      mccb: { desc: 'x', w: 1, h: 1, d: 1 },          // built-in
      mine: { desc: 'y', w: 1, h: 1, d: 1 },          // existing override
      brand_new: { desc: 'z', w: 1, h: 1, d: 1 } } });
    const v = E.validateLibraryFile(f, { mine: { desc: 'y' } });
    assert.equal(v.overwrite, 2);
    assert.equal(v.isNew, 1);
  });

  test('every malformed file is refused with a reason, never thrown', () => {
    const cases = [
      [undefined, /objek JSON/], [null, /objek JSON/], ['teks', /objek JSON/],
      [42, /objek JSON/],
      [{ format: 'lain', version: 1, components: {} }, /Bukan file library/],
      [good({ version: 0 }), /versi tidak valid/i],
      [good({ version: 1.5 }), /versi tidak valid/i],
      [good({ version: 99 }), /lebih baru/],
      [{ format: 'panel-builder-library', version: 1 }, /tidak memuat komponen/],
      [good({ components: {} }), /tidak memuat komponen|bisa dipakai/],
    ];
    for (const [input, re] of cases) {
      let v;
      assert.doesNotThrow(() => { v = E.validateLibraryFile(input, {}); },
        'validator threw on ' + String(JSON.stringify(input)).slice(0, 40));
      assert.equal(v.ok, false, 'accepted ' + String(JSON.stringify(input)).slice(0, 40));
      assert.match(v.error, re);
    }
  });

  test('unknown fields from a foreign file are stripped', () => {
    const v = E.validateLibraryFile(good({ components: { x: {
      desc: 'X', w: 10, h: 10, d: 10,
      evil: '<script>alert(1)</script>', __proto__x: 1, onclick: 'boom' } } }), {});
    assert.equal(v.ok, true);
    const keys = Object.keys(v.components.x);
    for (const bad of ['evil', '__proto__x', 'onclick'])
      assert.ok(!keys.includes(bad), 'field "' + bad + '" leaked through');
    assert.deepEqual(keys.sort(), ['d', 'desc', 'h', 'w']);
  });

  test('numbers and booleans are coerced, strings are capped', () => {
    const v = E.validateLibraryFile(good({ components: { x: { desc: 'X',
      w: '30', h: '60', d: '50', powerW: '2.5', dimsVerified: 'yes',
      vendor: 'V'.repeat(900) } } }), {});
    const x = v.components.x;
    assert.equal(typeof x.w, 'number');
    assert.equal(x.w, 30);
    assert.equal(x.powerW, 2.5);
    assert.equal(x.dimsVerified, true);
    assert.ok(x.vendor.length <= 400, 'long strings must be capped');
  });

  test('components that cannot be built are skipped, not imported broken', () => {
    const v = E.validateLibraryFile(good({ components: {
      ok: { desc: 'Fine', w: 10, h: 10, d: 10 },
      nodesc: { w: 10, h: 10, d: 10 },
      zerodim: { desc: 'Zero', w: 0, h: 10, d: 10 },
      negdim: { desc: 'Neg', w: -5, h: 10, d: 10 },
      'bad key!': { desc: 'Bad', w: 1, h: 1, d: 1 } } }), {});
    assert.deepEqual(Object.keys(v.components), ['ok']);
    assert.equal(v.skipped.length, 4);
    assert.ok(v.skipped.some((s) => /kode tidak valid/.test(s)));
  });

  test('a CPU without built-in I/O is demoted, not allowed to break module maths', () => {
    const v = E.validateLibraryFile(good({ components: { cpu: { desc: 'Bad CPU',
      w: 10, h: 10, d: 10, isPlc: true, builtinDi: 0, builtinDo: 0 } } }), {});
    assert.equal(v.components.cpu.isPlc, undefined);
    assert.equal(v.components.cpu.plcName, undefined);
    /* and it therefore cannot appear as a selectable model */
    assert.ok(!E.plcModels(v.components).some((m) => m.key === 'cpu'));
  });

  test('a valid CPU survives import and becomes selectable', () => {
    const v = E.validateLibraryFile(good({ components: { cpu: { desc: 'Good CPU',
      pn: 'GC-1', w: 100, h: 90, d: 70, cat: 'Control', mount: 'rail',
      isPlc: true, plcName: 'Good CPU', builtinDi: 16, builtinDo: 16, maxExp: 4,
      expDi: 'exp_di16', expDo: 'exp_do16', expAi: 'exp_ai4', expAo: 'exp_ao4' } } }), {});
    assert.equal(v.components.cpu.isPlc, true);
    assert.ok(E.plcModels(v.components).some((m) => m.key === 'cpu'));
    const r = E.compute(cfg({ plc: 'cpu', di: 24 }), { components: v.components });
    assert.equal(r.cpu.pn, 'GC-1');
    assert.equal(r.diExtra, 1);
  });

  test('only real image data URIs are carried across', () => {
    const v = E.validateLibraryFile(good({
      components: { a: { desc: 'A', w: 1, h: 1, d: 1, hasImage: true, imgVersion: 5 },
                    b: { desc: 'B', w: 1, h: 1, d: 1, hasImage: true } },
      images: { a: 'data:image/png;base64,AAA', b: 'http://evil.test/x.png' } }), {});
    assert.deepEqual(Object.keys(v.images), ['a']);
    assert.equal(v.components.a.hasImage, true);
    assert.equal(v.components.b.hasImage, undefined,
      'a component whose image was rejected must not claim to have one');
  });

  test('export → import is a faithful round trip', () => {
    const patch = { rt: { desc: 'Round trip', pn: 'RT-1', w: 33, h: 66, d: 44,
      powerW: 1.5, vendor: 'V', cat: 'Control', mount: 'door', dimsVerified: true } };
    const pkg = JSON.parse(JSON.stringify(E.exportLibrary(patch, ['rt'])));
    const v = E.validateLibraryFile(pkg, {});
    assert.equal(v.ok, true);
    for (const f of ['desc', 'pn', 'w', 'h', 'd', 'powerW', 'vendor', 'cat',
                     'mount', 'dimsVerified'])
      assert.deepEqual(v.components.rt[f], patch.rt[f], 'field ' + f + ' changed');
    /* and the imported component actually computes */
    const r = E.compute(cfg({ extras: [{ type: 'rt', qty: 1, place: 'door' }] }),
      { components: v.components });
    assert.ok(r.door.items.some((i) => i.type === 'rt'));
    assert.ok(r.bom.some((b) => b.pn === 'RT-1'));
  });

  test('validating does not mutate the file or the existing library', () => {
    const pkg = good();
    const snapshot = JSON.stringify(pkg);
    const existing = { mine: { desc: 'untouched' } };
    E.validateLibraryFile(pkg, existing);
    assert.equal(JSON.stringify(pkg), snapshot, 'input file was mutated');
    assert.deepEqual(existing, { mine: { desc: 'untouched' } });
    assert.equal(E.COMPONENT_DB.imported, undefined,
      'validation must not touch the built-in database');
  });
});

describe('side panels — where the exhaust fan actually lives', () => {
  test('fans left the backplate entirely', () => {
    const r = R();
    assert.ok(r.thermal.fans > 0, 'fixture needs fans');
    assert.equal(r.items.filter((i) => i.type === 'fan').length, 0,
      'a side-mounted fan must not occupy backplate space');
    assert.equal(r.side.right.filter((i) => i.type === 'fan').length, r.thermal.fans);
  });

  test('airflow crosses: intake low on the left, exhaust high on the right', () => {
    const r = R();
    const fan = r.side.right.find((i) => i.type === 'fan');
    const flt = r.side.left.find((i) => i.type === 'filter_out');
    assert.ok(fan && flt, 'both halves of the airflow path must exist');
    assert.ok(fan.y < r.H / 2, 'exhaust belongs high up');
    assert.ok(flt.y > r.H / 2, 'intake belongs low down');
    assert.equal(r.side.left.filter((i) => i.type === 'filter_out').length,
      r.thermal.fans, 'one intake per exhaust');
  });

  test('the side view is drawn depth × height, not width × height', () => {
    const r = R();
    for (const it of r.side.items) {
      const d = r.specs[it.type];
      assert.ok(it.x + d.w / 2 <= r.D + 0.01,
        `${it.tag} is wider than the ${r.D} mm depth`);
      assert.ok(it.y + d.h / 2 <= r.H + 0.01, `${it.tag} past the bottom`);
      assert.ok(it.x - d.w / 2 >= -0.01 && it.y - d.h / 2 >= -0.01);
    }
    assert.equal(r.side.fits, true);
  });

  test('fan and intake are tagged, and the tags reach the BOM and wiring', () => {
    const r = R();
    assert.ok(r.side.right.every((i) => /^E\d/.test(i.tag)), 'exhaust tags should be E*');
    assert.ok(r.side.left.every((i) => /^V\d/.test(i.tag)), 'intake tags should be V*');
    const ids = r.side.items.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate side ids');
    /* counted once, from the side layout — not added a second time by hand */
    assert.equal(r.bom.filter((b) => b.pn === 'SK-3239-100').length, 1);
    assert.equal(r.bom.find((b) => b.pn === 'SK-3239-100').qty, r.thermal.fans);
    assert.equal(r.bom.find((b) => b.pn === 'SK-3239-200').qty, r.thermal.fans);
    assert.equal(r.wiring.filter((w) => /Exhaust fan E/.test(w.to)).length, r.thermal.fans);
  });

  test('no cooling means no side devices and no cooling BOM lines', () => {
    const r = R({ vfd: 0, servo: 0, motor: 0, di: 2, do_: 2, ai: 0, ao: 0, hmi: 0, valve: 0 });
    assert.equal(r.thermal.method, 'natural');
    assert.equal(r.side.items.length, 0);
    assert.equal(r.bom.filter((b) => b.cat === 'Cooling').length, 0);
    assert.equal(r.side.fits, true, 'an empty side panel trivially fits');
  });

  test('a manual position moves a device, optionally to the other side', () => {
    const r = R({ sidePos: { 'fan#1': { x: 150, y: 600, side: 'left' } } });
    const f = r.side.items.find((i) => i.id === 'fan#1');
    assert.equal(f.y, 600);
    assert.equal(f.side, 'left', 'must be able to move a fan across sides');
    assert.equal(f.manual, true);
    assert.deepEqual(r.side.manual, ['fan#1']);
    assert.ok(r.side.left.some((i) => i.id === 'fan#1'));
    assert.ok(!r.side.right.some((i) => i.id === 'fan#1'));
  });

  test('only the moved device is pinned', () => {
    const auto = R();
    const r = R({ sidePos: { 'fan#1': { x: 150, y: 600 } } });
    for (const it of r.side.items) {
      if (it.id === 'fan#1') continue;
      const a = auto.side.items.find((x) => x.id === it.id);
      assert.equal(it.y, a.y, it.id + ' drifted');
    }
  });

  test('dragging a side device out of the panel is reported', () => {
    const r = R({ sidePos: { 'fan#1': { x: 150, y: 5000 } } });
    assert.deepEqual(r.side.draggedOutside, ['E1']);
    const w = r.warnings.find((x) => x.code === 'SIDE_DEVICE_OUTSIDE');
    assert.ok(w && w.level === 'error');
    assert.equal(r.side.fits, false);
  });

  test('a device wider than the panel depth is an error naming the real width', () => {
    const r = E.compute(cfg(), { components: { fan: { w: 280 } } });
    assert.equal(r.side.tooShallow, true);
    const w = r.warnings.find((x) => x.code === 'SIDE_TOO_SHALLOW');
    assert.ok(w && w.level === 'error');
    assert.match(w.msg, /280 mm/, 'must quote the actual width, not a hardcoded 150');
    assert.match(w.msg, new RegExp(String(r.D) + ' mm'));
  });

  test('library components can be sent to either side', () => {
    const l = R({ extras: [{ type: 'window', qty: 1, place: 'left' }] });
    const rt = R({ extras: [{ type: 'window', qty: 2, place: 'right' }] });
    assert.equal(l.side.left.filter((i) => i.type === 'window').length, 1);
    assert.equal(l.side.right.filter((i) => i.type === 'window').length, 0);
    assert.equal(rt.side.right.filter((i) => i.type === 'window').length, 2);
    /* and they must not land on the backplate or the door */
    assert.equal(l.items.filter((i) => i.type === 'window').length, 0);
    assert.equal(l.door.items.filter((i) => i.type === 'window').length, 0);
    assert.equal(rt.bom.find((b) => b.pn === 'WINDOW-200x150').qty, 2);
  });

  test('malformed sidePos entries are dropped', () => {
    const n = E.normalizeCfg({ sidePos: {
      'a#1': { x: 1 },                       // no y
      'b#1': { x: 1, y: 2, side: 'atas' },   // bad side is ignored, entry kept
      'c#1': { x: 3, y: 4, side: 'left' },
      'd#1': null } });
    assert.deepEqual(Object.keys(n.sidePos), ['b#1', 'c#1']);
    assert.deepEqual(n.sidePos['b#1'], { x: 1, y: 2 }, 'bad side must be stripped');
    assert.deepEqual(n.sidePos['c#1'], { x: 3, y: 4, side: 'left' });
  });

  test('the side layout does not disturb sizing or the BOM total', () => {
    const auto = R();
    const moved = R({ sidePos: { 'fan#1': { x: 150, y: 600, side: 'left' } } });
    assert.deepEqual([moved.W, moved.H, moved.D], [auto.W, auto.H, auto.D]);
    assert.deepEqual(moved.bom.map((b) => b.pn + ':' + b.qty),
                     auto.bom.map((b) => b.pn + ':' + b.qty));
  });

  test('removing the fan column freed real backplate width', () => {
    /* the old engine reserved 150 mm + gap on rail 1 for the fan */
    const r = R();
    const rail1 = r.rows.find((x) => x.list && /RAIL 1/.test(x.name));
    const used = rail1.list.reduce((t, k) => t + r.specs[k].w, 0);
    assert.ok(used <= r.W - r.assumptions.layout.pad * 2,
      'rail 1 should now be able to use the full backplate width');
  });
});

describe('load list — mixed ratings', () => {
  const MIXED = [{ kind: 'vfd', kW: 5.5, qty: 1 }, { kind: 'vfd', kW: 1.5, qty: 2 },
                 { kind: 'servo', kW: 0.75, qty: 2 },
                 { kind: 'dol', kW: 5.5, qty: 1 }, { kind: 'dol', kW: 1.5, qty: 2 }];

  test('an old project without a load list keeps its exact design', () => {
    /* Migrasi harus netral: hitungan lama disintesis dengan rating asumsi. */
    const legacy = E.compute({ di: 24, do_: 16, ai: 4, ao: 2,
                               vfd: 3, servo: 2, motor: 6, hmi: 2, valve: 5 });
    const now = R();
    assert.equal(legacy.flcA.toFixed(3), now.flcA.toFixed(3));
    assert.equal(legacy.mccb.pn, now.mccb.pn);
    assert.equal(legacy.heat, now.heat);
    assert.deepEqual([legacy.W, legacy.H, legacy.D], [now.W, now.H, now.D]);
    assert.equal(legacy.bom.length, now.bom.length);
    /* dan daftar bebannya tersintesis */
    assert.deepEqual(legacy.cfg.loads, [
      { kind: 'vfd', kW: 2.2, qty: 3 },
      { kind: 'servo', kW: 0.75, qty: 2 },
      { kind: 'dol', kW: 1.5, qty: 1 },
    ]);
  });

  test('counts are derived from the list, never the other way round', () => {
    const n = E.normalizeCfg({ loads: MIXED });
    assert.equal(n.vfd, 3);
    assert.equal(n.servo, 2);
    assert.equal(n.dolCount, 3);
    assert.equal(n.motor, 8);
    /* hitungan yang dikirim bersamaan HARUS diabaikan */
    const clash = E.normalizeCfg({ loads: MIXED, vfd: 99, servo: 99, motor: 99 });
    assert.equal(clash.vfd, 3);
    assert.equal(clash.motor, 8);
  });

  test('each rating gets its own drive model and footprint', () => {
    const r = R({ loads: MIXED });
    const models = [...new Set(r.items.filter((i) => /^vfd_|^servo_/.test(i.type))
      .map((i) => i.type))].map((t) => r.specs[t]);
    const pns = models.map((m) => m.pn).sort();
    assert.deepEqual(pns, ['FR-D740-1.5K', 'FR-D740-5.5K', 'MR-J4-100A4']);
    const big = models.find((m) => m.pn === 'FR-D740-5.5K');
    const small = models.find((m) => m.pn === 'FR-D740-1.5K');
    assert.ok(big.w > small.w && big.h > small.h,
      'a 5.5 kW drive must not share the 1.5 kW footprint');
  });

  test('each DOL rating gets a properly sized starter', () => {
    const r = R({ loads: MIXED });
    const starters = [...new Set(r.items
      .filter((i) => r.specs[i.type].baseKey === 'contactor').map((i) => i.type))]
      .map((t) => r.specs[t].pn).sort();
    assert.equal(starters.length, 2, 'expected two contactor sizes: ' + starters);
    const overloads = [...new Set(r.items
      .filter((i) => r.specs[i.type].baseKey === 'overload').map((i) => i.type))]
      .map((t) => r.specs[t].pn);
    assert.equal(overloads.length, 2, 'expected two overload ranges');
    /* dan yang besar benar-benar untuk motor besar */
    assert.ok(r.bom.some((b) => b.pn === 'LC1D18BD'), 'no starter for the 5.5 kW motor');
    assert.ok(r.bom.some((b) => b.pn === 'LC1D09BD'), 'no starter for the 1.5 kW motors');
  });

  test('mixed ratings change the electrical result, not just the labels', () => {
    const mixed = R({ loads: MIXED });
    const flat = R({ loads: [{ kind: 'vfd', kW: 2.2, qty: 3 },
                             { kind: 'servo', kW: 0.75, qty: 2 },
                             { kind: 'dol', kW: 1.5, qty: 3 }] });
    assert.ok(mixed.flcA > flat.flcA + 5, 'FLC did not follow the ratings');
    assert.notEqual(mixed.mccb.pn, flat.mccb.pn, 'breaker did not resize');
    assert.ok(mixed.heat > flat.heat, 'heat did not follow the ratings');
    assert.ok(mixed.startA > flat.startA, 'starting current did not follow');
  });

  test('the load schedule lists one row per entry', () => {
    const r = R({ loads: MIXED });
    const motorRows = r.schedule.filter((x) => x.kind);
    assert.equal(motorRows.length, MIXED.length);
    for (const l of MIXED)
      assert.ok(motorRows.some((x) => x.kind === l.kind && x.kW === l.kW && x.qty === l.qty),
        'missing schedule row for ' + JSON.stringify(l));
    /* dan tiap baris memakai PF/efisiensi yang benar untuk jenisnya */
    const vfdRow = motorRows.find((x) => x.kind === 'vfd');
    assert.equal(vfdRow.pf, E.ASSUMPTIONS.pf.vfd);
  });

  test('only DOL loads carry locked-rotor inrush', () => {
    const r = R({ loads: MIXED });
    for (const row of r.schedule.filter((x) => x.kind))
      if (row.kind === 'dol')
        assert.ok(row.startEach > row.aEach * 5, 'DOL should inrush');
      else
        assert.equal(row.startEach, row.aEach, row.kind + ' must be soft-started');
  });

  test('a rating between frames steps up and says so', () => {
    const r = R({ loads: [{ kind: 'vfd', kW: 4.0, qty: 1 }] });
    assert.ok(r.bom.some((b) => b.pn === 'FR-D740-5.5K'), 'did not step up to 5.5 kW');
    const w = r.warnings.find((x) => x.code === 'DRIVE_FRAME');
    assert.ok(w && w.level === 'info');
    assert.match(w.msg, /4 kW/);
  });

  test('a rating above the largest frame is an explicit warning', () => {
    const r = R({ loads: [{ kind: 'vfd', kW: 30, qty: 1 }] });
    const w = r.warnings.find((x) => x.code === 'DRIVE_OVER_RANGE');
    assert.ok(w && w.level === 'warn');
    assert.match(w.msg, /30 kW/);
    assert.ok(Number.isFinite(r.heat), 'must still compute');
  });

  test('part numbers come from a table, not a formula', () => {
    /* MR-JE 750 W adalah -70A, bukan -75A: penomorannya tidak seragam */
    assert.ok(R({ supplyV: 230, loads: [{ kind: 'servo', kW: 0.75, qty: 1 }] })
      .bom.some((b) => b.pn === 'MR-JE-70A'));
    assert.ok(R({ supplyV: 230, loads: [{ kind: 'servo', kW: 0.4, qty: 1 }] })
      .bom.some((b) => b.pn === 'MR-JE-40A'));
    assert.ok(R({ supplyV: 400, loads: [{ kind: 'servo', kW: 2, qty: 1 }] })
      .bom.some((b) => b.pn === 'MR-J4-200A4'));
  });

  test('malformed load entries are dropped, not propagated', () => {
    const n = E.normalizeCfg({ loads: [
      { kind: 'vfd', kW: 2.2, qty: 2 },
      { kind: 'nonsense', kW: 1, qty: 1 },      /* jenis tidak dikenal */
      { kind: 'vfd', kW: 0, qty: 1 },           /* daya nol */
      { kind: 'dol', kW: 1.5, qty: 0 },         /* qty difloor ke 1 */
      null, 'junk',
    ] });
    assert.deepEqual(n.loads, [{ kind: 'vfd', kW: 2.2, qty: 2 },
                               { kind: 'dol', kW: 1.5, qty: 1 }]);
  });

  test('an empty load list is a valid panel', () => {
    const r = E.compute({ ...E.DEFAULT_CFG, loads: [], vfd: 0, servo: 0, motor: 0 });
    assert.deepEqual(r.cfg.loads, []);
    assert.equal(r.items.filter((i) => /^vfd_|^servo_/.test(i.type)).length, 0);
    assert.ok(Number.isFinite(r.flcA) && r.flcA > 0, 'control load still draws current');
    assert.ok(!r.rows.some((x) => x.list && /DRIVES/.test(x.name)), 'empty drives rail drawn');
  });

  test('a load list survives a JSON round trip', () => {
    const a = R({ loads: MIXED });
    const b = E.compute(JSON.parse(JSON.stringify(a.cfg)));
    assert.equal(b.flcA.toFixed(4), a.flcA.toFixed(4));
    assert.equal(b.mccb.pn, a.mccb.pn);
    assert.equal(b.items.length, a.items.length);
    assert.deepEqual(b.cfg.loads, a.cfg.loads);
  });
});

describe('24 V capacity follows the supplies actually installed', () => {
  const withPsu = (type, qty) =>
    R({ extras: [{ type, qty, place: 'plate', rail: 1 }] });

  test('adding a supply raises capacity and lowers utilisation', () => {
    /* Bug yang dilaporkan: BOM dan gambar menunjukkan dua unit, tapi
       utilization tetap dihitung dari satu supply hasil pemilihan otomatis. */
    const one = R();
    const two = withPsu('psu', 1);
    assert.equal(two.psuUnits.length, 2, 'second supply not counted');
    assert.equal(two.psuCapacity, one.psuCapacity * 2);
    assert.ok(two.util < one.util - 1,
      `utilisation did not move: ${one.util.toFixed(1)}% → ${two.util.toFixed(1)}%`);
    /* dan angkanya konsisten dengan BOM */
    const line = two.bom.find((b) => b.pn === two.psuUnits[0].pn);
    assert.equal(line.qty, 2);
  });

  test('utilisation is load divided by installed capacity', () => {
    for (const [type, qty, cap] of [['psu_5a', 1, 5], ['psu_10a', 2, 20],
                                    ['psu_20a', 1, 20], ['psu_40a', 1, 40]]) {
      const r = withPsu(type, qty);
      assert.equal(r.psuCapacity, cap, type + ' x' + qty);
      const expect = (r.dcAmps / (cap * r.psu.derate)) * 100;
      assert.ok(Math.abs(r.util - expect) < 0.01,
        `${type}: util ${r.util.toFixed(1)} vs ${expect.toFixed(1)}`);
    }
  });

  test('choosing a supply yourself disables the automatic one', () => {
    const r = withPsu('psu_20a', 1);
    assert.equal(r.psuManual, true);
    assert.equal(r.psuUnits.length, 1, 'the auto supply was added as well');
    assert.equal(r.psuCapacity, 20);
    assert.equal(r.items.filter((i) => i.type === 'psu').length, 0,
      'automatic slot still placed');
  });

  test('the generic psu is the automatic slot, not a manual choice', () => {
    const r = withPsu('psu', 1);
    assert.equal(r.psuManual, false, 'adding the auto slot must not disable auto-sizing');
    assert.equal(r.items.filter((i) => i.type === 'psu').length, 2);
  });

  test('an undersized choice is reported instead of silently accepted', () => {
    const r = withPsu('psu_5a', 1);
    assert.ok(r.util > E.ASSUMPTIONS.psuMaxUtil * 100);
    const w = r.warnings.find((x) => x.code === 'PSU_SHORT');
    assert.ok(w, 'no shortage warning');
    assert.match(w.msg, /5 A/);
    assert.match(w.msg, /kamu pilih/, 'should point at the manual choice');
  });

  test('over 100% is an error, merely over the cap is a warning', () => {
    const over = R({ di: 128, valve: 24, hmi: 4,
                     extras: [{ type: 'psu_5a', qty: 1, place: 'plate', rail: 1 }] });
    assert.ok(over.util > 100);
    assert.equal(over.warnings.find((x) => x.code === 'PSU_SHORT').level, 'error');
  });

  test('a panel with no supply at all is an error', () => {
    /* library override yang menghapus kapasitas semua supply */
    const r = E.compute(cfg(), { components: { psu: { psuA: 0 } } });
    assert.equal(r.psuUnits.length, 0);
    assert.ok(r.warnings.some((x) => x.code === 'PSU_MISSING' && x.level === 'error'));
    assert.ok(Number.isFinite(r.heat), 'must still compute');
  });

  test('N−1 is reported only when there is more than one supply', () => {
    assert.equal(R().psuRedundantUtil, null, 'single supply cannot be redundant');
    const two = withPsu('psu_10a', 2);
    assert.ok(two.psuRedundantUtil > two.util,
      'losing a unit must raise utilisation');
    /* dua 10 A: normal 25%, kehilangan satu -> 50% */
    assert.ok(Math.abs(two.psuRedundantUtil - two.util * 2) < 0.01);
  });

  test('the supply catalogue declares real capacities', () => {
    for (const [k, a] of [['psu_5a', 5], ['psu_10a', 10], ['psu_20a', 20], ['psu_40a', 40]]) {
      const d = E.COMPONENT_DB[k];
      assert.ok(d, 'missing catalogue entry ' + k);
      assert.equal(d.psuA, a);
      assert.match(d.pn, new RegExp('/' + a + '$'), k + ' part number mismatch');
      assert.equal(d.cat, 'Power');
    }
    /* lebar naik seiring kapasitas — footprint ikut benar */
    const w = ['psu_5a', 'psu_10a', 'psu_20a', 'psu_40a'].map((k) => E.COMPONENT_DB[k].w);
    for (let i = 1; i < w.length; i++)
      assert.ok(w[i] > w[i - 1], 'a bigger supply should not be narrower');
  });

  test('installed supplies stay consistent with the drawing and BOM', () => {
    const r = withPsu('psu_10a', 3);
    assert.equal(r.psuUnits.length, 3);
    /* setiap unit yang dihitung harus benar-benar ada di layout */
    for (const u of r.psuUnits)
      assert.ok(r.items.some((i) => i.tag === u.tag), u.tag + ' counted but not placed');
    assert.equal(r.bom.find((b) => b.pn === 'QUINT4-PS/1AC/24DC/10').qty, 3);
  });
});

describe('drive thermal clearance', () => {
  test('the drives rail gets breathing room, ordinary rails do not', () => {
    const r = R();
    const rows = r.rows.filter((x) => x.list);
    const drives = rows.find((x) => /DRIVES/.test(x.name));
    assert.ok(drives, 'fixture needs a drives rail');
    assert.equal(drives.clearance, E.ASSUMPTIONS.layout.driveClearance);
    for (const row of rows)
      if (!/DRIVES/.test(row.name))
        assert.equal(row.clearance, E.ASSUMPTIONS.layout.gapV,
          row.name + ' should use the ordinary gap');
  });

  test('the clearance is real space, not just a number', () => {
    const r = R();
    const rows = r.rows.filter((x) => x.list);
    const i = rows.findIndex((x) => /DRIVES/.test(x.name));
    assert.ok(i > 0, 'need a rail above the drives');
    const above = rows[i - 1], drive = rows[i];
    const gap = (drive.railY - drive.h / 2) - (above.railY + above.h / 2);
    assert.ok(gap >= E.ASSUMPTIONS.layout.driveClearance - 0.01,
      `only ${Math.round(gap)} mm above the drives rail`);
  });

  test('a panel with drives is taller than one without', () => {
    const withDrives = R({ vfd: 3, servo: 2, motor: 6 });
    const without = R({ vfd: 0, servo: 0, motor: 6 });
    assert.ok(withDrives.needH > without.needH,
      'clearance did not affect the required height');
  });

  test('no clearance is reserved when there are no drives', () => {
    const r = R({ vfd: 0, servo: 0, motor: 6 });
    for (const row of r.rows.filter((x) => x.list))
      assert.equal(row.clearance, E.ASSUMPTIONS.layout.gapV);
    assert.ok(!r.warnings.some((w) => w.code === 'DRIVE_CLEARANCE'));
  });

  test('a drive dragged onto a cramped rail is reported', () => {
    const base = R();
    const rows = base.railRows;
    /* pindahkan VFD ke rail 1 (incoming), yang jaraknya cuma gapV */
    const vfdId = base.items.find((i) => base.specs[i.type].baseKey === 'vfd').id;
    const r = R({ platePos: { [vfdId]: { x: 400, row: rows[0] } } });
    const w = r.warnings.find((x) => x.code === 'DRIVE_CLEARANCE');
    assert.ok(w && w.level === 'warn', 'cramped drive not reported');
    assert.match(w.msg, /T1/);
    assert.match(w.msg, new RegExp(String(E.ASSUMPTIONS.layout.driveClearance)));
  });

  test('the clearance is tunable like the other layout parameters', () => {
    const tight = E.compute(cfg(), { layout: { driveClearance: 12 } });
    const loose = E.compute(cfg(), { layout: { driveClearance: 200 } });
    assert.ok(loose.needH > tight.needH, 'the setting has no effect');
    assert.equal(tight.rows.find((x) => x.list && /DRIVES/.test(x.name)).clearance, 12);
  });
});

describe('front cover & side panels — overlap is reported', () => {
  test('the generated layouts never overlap', () => {
    for (const c of [{}, { hmi: 4 }, { motor: 9 }, { cabW: 1200, cabH: 1200 }]) {
      const r = R(c);
      assert.deepEqual(r.door.overlaps, [], 'door overlap in ' + JSON.stringify(c));
      assert.deepEqual(r.side.overlaps, [], 'side overlap in ' + JSON.stringify(c));
    }
  });

  test('two door devices in the same place are named', () => {
    const auto = R();
    const est = auto.door.items.find((i) => i.type === 'estop');
    const r = R({ doorPos: { 'pb_start#1': { x: est.x, y: est.y } } });
    assert.deepEqual(r.door.overlaps, ['S1/S3']);
    const w = r.warnings.find((x) => x.code === 'DEVICE_OVERLAP');
    assert.ok(w, 'no warning raised');
    assert.match(w.msg, /pintu/);
    assert.match(w.msg, /dibor/);
  });

  test('side devices only clash with the same side', () => {
    const auto = R();
    const e1 = auto.side.right.find((i) => i.type === 'fan');
    /* pindah ke posisi yang sama TAPI sisi berbeda — tidak boleh dianggap bentrok */
    const across = R({ sidePos: { 'fan#2': { x: e1.x, y: e1.y, side: 'left' } } });
    assert.deepEqual(across.side.overlaps, [],
      'devices on opposite sides cannot collide');
    /* sisi yang sama -> bentrok */
    const same = R({ sidePos: { 'fan#2': { x: e1.x, y: e1.y, side: 'right' } } });
    assert.deepEqual(same.side.overlaps, ['E1/E2']);
  });

  test('touching is allowed, only intrusion is reported', () => {
    const auto = R();
    const est = auto.door.items.find((i) => i.type === 'estop');
    const de = auto.specs.estop, ds = auto.specs.pb_start;
    /* tepat bersentuhan di tepi kanan E-stop */
    const r = R({ doorPos: { 'pb_start#1': { x: est.x + de.w / 2 + ds.w / 2, y: est.y } } });
    assert.deepEqual(r.door.overlaps, [], 'touching must not count as overlapping');
  });
});

describe('front cover — manual positioning', () => {
  test('a manual position overrides the generated one', () => {
    const r = R({ doorPos: { 'estop#1': { x: 150, y: 520 } } });
    const e = r.door.items.find((i) => i.id === 'estop#1');
    assert.equal(e.x, 150);
    assert.equal(e.y, 520);
    assert.equal(e.manual, true);
  });

  test('only moved devices are pinned; the rest keep flowing', () => {
    const auto = R();
    const r = R({ doorPos: { 'pb_start#1': { x: 100, y: 600 } } });
    assert.deepEqual(r.door.manual, ['pb_start#1']);
    for (const it of r.door.items) {
      if (it.id === 'pb_start#1') continue;
      const a = auto.door.items.find((x) => x.id === it.id);
      assert.equal(it.x, a.x, it.id + ' moved without being asked');
      assert.equal(it.y, a.y, it.id + ' moved without being asked');
    }
  });

  test('dragging a device off the door is reported as such', () => {
    const r = R({ doorPos: { 'estop#1': { x: -40, y: 100 } } });
    assert.deepEqual(r.door.draggedOutside, ['S1']);
    const w = r.warnings.find((x) => x.code === 'DOOR_DEVICE_OUTSIDE');
    assert.ok(w && w.level === 'error');
    assert.match(w.msg, /S1/);
    assert.equal(r.door.fits, false);
  });

  test('an auto-layout overflow is NOT blamed on manual placement', () => {
    const r = R({ cabW: 300, cabH: 400, hmi: 4 });
    assert.ok(!r.warnings.some((x) => x.code === 'DOOR_DEVICE_OUTSIDE'),
      'auto overflow misreported as a dragged device');
    assert.ok(r.warnings.some((x) => x.code === 'DOOR_TOO_SMALL'));
  });

  test('manual positions extend the reported extent', () => {
    const r = R({ doorPos: { 'lamp_flt#1': { x: 200, y: 900 } } });
    assert.ok(r.door.neededH >= 900, 'extent ignores a manually placed device');
  });

  test('positions for devices that no longer exist are harmless', () => {
    const r = R({ hmi: 0, doorPos: { 'hmi#1': { x: 100, y: 100 } } });
    assert.ok(!r.door.items.some((i) => i.type === 'hmi'));
    assert.ok(Number.isFinite(r.door.neededH));
    assert.equal(r.door.manual.length, 0);
  });

  test('a position is restored if the device comes back', () => {
    const pos = { 'hmi#1': { x: 250, y: 300 } };
    assert.equal(R({ hmi: 0, doorPos: pos }).door.manual.length, 0);
    const back = R({ hmi: 1, doorPos: pos });
    assert.deepEqual(back.door.manual, ['hmi#1']);
    assert.equal(back.door.items.find((i) => i.id === 'hmi#1').x, 250);
  });

  test('malformed positions are dropped, not propagated', () => {
    const r = R({ doorPos: {
      'estop#1': { x: 'abc', y: null },
      'pb_stop#1': { x: 10 },
      'pb_start#1': { x: 90, y: 400 },
    } });
    assert.deepEqual(Object.keys(r.cfg.doorPos), ['pb_start#1']);
    const bad = [];
    (function scan(o, p) {
      if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(p); return; }
      if (o && typeof o === 'object') Object.keys(o).forEach((k) => scan(o[k], p + '.' + k));
    })(r.door, 'door');
    assert.deepEqual(bad, []);
  });

  test('manual placement does not change the BOM', () => {
    const auto = R();
    const moved = R({ doorPos: { 'estop#1': { x: 150, y: 520 } } });
    assert.deepEqual(moved.bom.map((b) => b.pn + ':' + b.qty),
                     auto.bom.map((b) => b.pn + ':' + b.qty));
  });
});

describe('no PLC', () => {
  const noPlc = (over) => R(Object.assign({ plc: E.NO_PLC, hmi: 0 }, over || {}));

  test('no CPU, no I/O rack, no Ethernet switch', () => {
    const r = noPlc();
    assert.equal(r.hasPlc, false);
    for (const t of ['plc', 'di16', 'do16', 'ad4', 'da4', 'eth'])
      assert.equal(r.items.filter((i) => i.type === t).length, 0, t + ' still placed');
    assert.equal(r.diExtra + r.doExtra + r.aiMods + r.aoMods, 0);
    assert.ok(!r.bom.some((b) => /FX5U|FX5-|FL-SWITCH/.test(b.pn)), 'PLC parts in BOM');
  });

  test('the 24 V budget drops accordingly', () => {
    assert.ok(noPlc().dcLoad < R({ hmi: 0 }).dcLoad);
    assert.ok(!noPlc().dcDetail.internal.some((x) => /PLC CPU/.test(x.name)));
  });

  test('no wiring row references a PLC that is not there', () => {
    const r = noPlc({ di: 24, do_: 16, valve: 5, motor: 6 });
    const refs = r.wiring.filter((w) => /PLC/.test(w.from + ' ' + w.to));
    assert.deepEqual(refs, [], 'dangling PLC references: ' +
      refs.slice(0, 3).map((w) => w.no + ' ' + w.from + '→' + w.to).join('; '));
  });

  test('starters are commanded from the door instead', () => {
    const r = noPlc({ vfd: 0, servo: 0, motor: 3 });
    assert.ok(r.wiring.some((w) => /K1 A1/.test(w.to) && /START|latch/i.test(w.from)),
      'no hard-wired start path');
  });

  test('configured I/O is preserved but flagged as unusable', () => {
    const r = noPlc({ di: 24, do_: 16, ai: 4, ao: 2 });
    assert.equal(r.cfg.di, 24, 'user data must not be destroyed');
    const w = r.warnings.find((x) => x.code === 'IO_WITHOUT_PLC');
    assert.ok(w && w.level === 'warn');
    assert.match(w.msg, /46/);
  });

  test('an HMI without a PLC is called out', () => {
    const r = R({ plc: E.NO_PLC, hmi: 2 });
    assert.ok(r.warnings.some((x) => x.code === 'HMI_WITHOUT_PLC'));
  });

  test('safety chain, door devices and starters still work', () => {
    const r = noPlc({ vfd: 0, servo: 0, motor: 4 });
    assert.equal(r.items.filter((i) => i.type === 'safety').length, 1);
    assert.equal(r.items.filter((i) => r.specs[i.type].baseKey === 'contactor').length, 4);
    assert.equal(r.door.items.filter((i) => i.type === 'estop').length, 1);
    assert.ok(r.wiring.some((w) => /13\/14/.test(w.from)), 'safety output unwired');
  });

  test('all invariants hold with no PLC', () => {
    const r = noPlc({ di: 48, do_: 32, motor: 8, valve: 10 });
    const bad = [];
    (function scan(o, p) {
      if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(p); return; }
      if (o && typeof o === 'object') Object.keys(o).forEach((k) => scan(o[k], p + '.' + k));
    })(r, 'R');
    assert.deepEqual(bad, []);
    assert.ok(r.util <= E.ASSUMPTIONS.psuMaxUtil * 100 + 1e-9);
    assert.equal(r.side.items.filter((i) => i.type === 'fan').length, r.thermal.fans);
    const nos = r.wiring.map((w) => w.no);
    assert.equal(new Set(nos).size, nos.length, 'duplicate wire numbers');
  });

  test('selecting a PLC again restores the I/O rack', () => {
    const off = noPlc({ di: 48 });
    const on = R({ di: 48, hmi: 0 });
    assert.equal(off.diExtra, 0);
    assert.equal(on.diExtra, 2);
  });
});

/* helper used inside a describe where forEachCase's test() nesting is awkward */
function forEachCaseInline(fn) { MATRIX.forEach(({ c }) => fn(R(c), cfg(c))); }
