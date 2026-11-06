const assert = require('node:assert/strict');
const model = require('../assets/model.js');

function makeDraws(count = 110) {
  let state = 539;
  const random = () => {
    state = (state * 48271) % 2147483647;
    return (state - 1) / 2147483646;
  };
  const draws = [];
  for (let index = 0; index < count; index += 1) {
    const values = new Set();
    while (values.size < 5) values.add(1 + Math.floor(random() * 39));
    const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
    draws.push({
      period: String(115000001 + index),
      date,
      numbers: Array.from(values).sort((a, b) => a - b)
    });
  }
  return draws.reverse(); // newest first
}

const draws = makeDraws();
const start = draws[4]; // most recent eligible start: four later draws, no D5 yet
const result = model.calculateFinalPrediction(draws, start.period);

assert.equal(result.candidatePool.length, 15, 'original candidate pool is fixed at 15');
assert.equal(result.contextChronological.length, 5, 'context contains D0 through D4');
assert.equal(result.contextChronological[0].period, start.period, 'first context draw is D0');
assert.equal(result.observedFollowingFour.length, 4, 'exactly four observed draws are excluded');
assert.equal(result.targetDraw, null, 'D5 is pending for the fifth newest draw');

const excludedSet = new Set(result.observedFollowingFour.flatMap(draw => draw.numbers));
for (const item of result.survivors) {
  assert.equal(excludedSet.has(item.number), false, `survivor ${item.number} must not occur in D1-D4`);
}
for (const item of result.eliminatedCandidates) {
  assert.equal(excludedSet.has(item.number), true, `eliminated ${item.number} must occur in D1-D4`);
}
assert.equal(result.survivors.length + result.eliminatedCandidates.length, 15, 'all original candidates are accounted for');
assert.deepEqual(result.transition.perTrigger.map(item => item.trigger), start.numbers.slice().sort((a, b) => a - b));

// Changing the D5 result cannot change the candidate ranking (no future leakage).
const changedTarget = draws.map(draw => ({ ...draw, numbers: draw.numbers.slice() }));
changedTarget[0].numbers = [1, 2, 3, 4, 5];
const resultWithChangedD5 = model.calculateFinalPrediction(changedTarget, start.period);
assert.deepEqual(
  result.candidatePool.map(item => [item.number, item.score]),
  resultWithChangedD5.candidatePool.map(item => [item.number, item.score]),
  'D5 must not leak into the ranking'
);

assert.throws(
  () => model.calculateFinalPrediction(draws, draws[0].period),
  /還需要4期/,
  'the newest issue cannot be used until four later draws exist'
);
assert.throws(() => model.validateTriggers([1, 1, 2, 3, 4]), /不可重複/);
assert.equal(model.FIVE_DRAW_BASE_PROBABILITY > 0.49 && model.FIVE_DRAW_BASE_PROBABILITY < 0.50, true);

console.log('PASS: top-15 ranking, D1-D4 exclusion, D0 handling, D5 no-leakage, and output inputs.');
