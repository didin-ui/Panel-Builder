/* Panel Builder Assistant — engine tests.  Run: npm test  (Node 18+, no deps)

   Two kinds of test here:
     GOLDEN     — pins the headline numbers for the reference machine, so an
                  accidental change to a constant shows up as a diff.
     INVARIANTS — properties that must hold for EVERY config. These are the
                  ones that catch real regressions; the golden numbers only
                  catch change, not wrongness.                                */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

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
    assert.equal(r.thermal.Ae.toFixed(3), '1.996');
    assert.equal(r.thermal.method, 'forced');
    assert.equal(r.fans, 2);
    assert.equal(Math.round(r.thermal.requiredCfm), 67);
    assert.equal(r.temp, 35);
  });

  test('enclosure and schedules', () => {
    assert.deepEqual([r.W, r.H, r.D], [800, 1000, 300]);
    assert.equal(r.termPoints, 92);
    assert.equal(r.wires, 119);
    assert.equal(r.bom.length, 59);
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
    const inLayout = r.items.filter((i) => i.type === 'fan').length;
    const fanLine = r.bom.find((b) => b.pn === 'SK-3239-100');
    const filterLine = r.bom.find((b) => b.pn === 'SK-3239-200');
    assert.equal(inLayout, r.thermal.fans, 'layout vs thermal');
    assert.equal(fanLine ? fanLine.qty : 0, r.thermal.fans, 'BOM vs thermal');
    assert.equal(filterLine ? filterLine.qty : 0, r.thermal.fans,
      'every fan needs a matching outlet filter');
    const fanWires = r.wiring.filter((w) => /Filter fan/.test(w.to)).length;
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
      assert.ok(E.COMPONENT_DB[it.type], `unknown component type "${it.type}"`);
    const railRows = r.rows.filter((x) => x.list);
    const placedOnRails = railRows.reduce((t, x) => t + x.list.length, 0);
    const fanCount = r.items.filter((i) => i.type === 'fan').length;
    assert.equal(placedOnRails, r.items.length - fanCount,
      'every rail entry must produce exactly one placed item');
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
    assert.ok(r.warnings.some((w) => w.code === 'SERVO_FRAME'));
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
    assert.equal(r.items.filter((i) => i.type === 'fan').length, r.thermal.fans);
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
    for (const it of r.items) if (!byType[it.type]) byType[it.type] = it.tag;
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
    assert.equal(r.items.filter((i) => i.type === 'fan').length, r.thermal.fans);
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
    const r = R({ motor: 6, vfd: 0, servo: 0,
                  platePos: { 'contactor#1': { x: 500 } } });
    const k = r.items.find((i) => i.id === 'contactor#1');
    const f = r.items.find((i) => i.id === 'overload#1');
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
    assert.equal(r.items.filter((i) => i.type === 'contactor').length, 4);
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
    assert.equal(r.items.filter((i) => i.type === 'fan').length, r.thermal.fans);
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
