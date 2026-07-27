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
    assert.equal(Math.round(r.totalW), 11766);          // real input power, W
    assert.equal(Math.round(r.totalVA), 12801);         // apparent power, VA
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
    assert.equal(r.dcInternalW.toFixed(1), '91.5');
    assert.equal(r.dcExternalW.toFixed(1), '26.9');
    assert.equal(r.psu.pn, 'QUINT4-PS/1AC/24DC/10');
    assert.equal(Math.round(r.util), 49);
  });

  test('thermal', () => {
    assert.equal(r.heat, 401);
    assert.equal(r.thermal.Ae.toFixed(3), '1.996');
    assert.equal(r.thermal.method, 'forced');
    assert.equal(r.fans, 2);
    assert.equal(Math.round(r.thermal.requiredCfm), 66);
    assert.equal(r.temp, 35);
  });

  test('enclosure and schedules', () => {
    assert.deepEqual([r.W, r.H, r.D], [800, 1000, 300]);
    assert.equal(r.termPoints, 92);
    assert.equal(r.wires, 107);
    assert.equal(r.bom.length, 48);
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

/* helper used inside a describe where forEachCase's test() nesting is awkward */
function forEachCaseInline(fn) { MATRIX.forEach(({ c }) => fn(R(c), cfg(c))); }
