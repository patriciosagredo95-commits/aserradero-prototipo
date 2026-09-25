import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAMETERS, createOptimizer, normalizeConfig } from '../dist/optimizer.js';

const base = {
  targets: [{ thickness: 22, width: 125 }, { thickness: 22, width: 110 }],
  recoveries: [{ thickness: 22, width: 75 }, { thickness: 22, width: 60 }],
  criterion: 'both', length: 4000, kerfBand: 3.4, kerfGang: 4.2,
  kerfEdger: 3.8, margin: 0, maxBases: 3
};

test('catalogue and defaults are normalized', () => {
  assert.deepEqual(DIAMETERS, [16,18,20,22,24,26,28,30,32,34,36,38,42]);
  const config = normalizeConfig(base);
  assert.equal(config.products.length, 4);
  assert.equal(config.length, 4000);
  assert.equal(config.searchMode, 'detailed');
});

test('all catalogue diameters return geometrically valid results', () => {
  const engine = createOptimizer(base);
  for (const diameter of DIAMETERS) {
    const result = engine.solve(diameter);
    assert.equal(result.diameterCm, diameter);
    assert.ok(result.geometricYield <= 100.0001);
    assert.equal(result.counts.length, 4);
    for (const piece of result.pieces) {
      assert.ok(piece.x * piece.x + piece.y * piece.y <= result.radius * result.radius + 1e-4);
    }
  }
});

test('custom recovery list and length change the optimization output', () => {
  const short = createOptimizer({ ...base, length: 2500, recoveries: [{ thickness: 22, width: 60 }] }).solve(28);
  const long = createOptimizer({ ...base, length: 6000, recoveries: [{ thickness: 22, width: 60 }, { thickness: 22, width: 50 }] }).solve(28);
  assert.ok(long.volume > short.volume);
  assert.equal(long.counts.length, 4);
});

test('objective B can be disabled without becoming a selected product', () => {
  const engine = createOptimizer({ ...base, targetBEnabled: false });
  const result = engine.solve(28);
  assert.equal(engine.config.targetBEnabled, false);
  assert.equal(result.counts[1].quantity, 0);
  assert.equal(result.mask & 2, 0);
  assert.ok(result.counts[0].quantity > 0);
});

test('duplicate and invalid inputs are rejected', () => {
  assert.throws(() => normalizeConfig({ ...base, recoveries: [{ thickness: 22, width: 125 }] }), /repetida/);
  assert.throws(() => normalizeConfig({ ...base, targets: [{ thickness: 0, width: 125 }, base.targets[1]] }), /entre 1 y 1000/);
});
