const assert = require('node:assert/strict');
const model = require('../assets/model.js');

function makeDraws(count = 130) {
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
    draws.push({ period: String(115000001 + index), date, numbers: Array.from(values).sort((a, b) => a - b) });
  }
  return draws.reverse();
}

const draws = makeDraws();
assert.deepEqual(model.SUPPORTED_HISTORY_WINDOWS, [35, 49]);
assert.deepEqual(model.SUPPORTED_EXCLUSION_COUNTS, [3, 4]);

for (const mode of [
  { historyWindow: 35, exclusionCount: 3, pickCount: 2 },
  { historyWindow: 49, exclusionCount: 4, pickCount: 2 }
]) {
  const startIndex = mode.exclusionCount;
  const start = draws[startIndex]; // newest eligible D0; next target not yet known
  const result = model.calculateFinalPrediction(draws, start.period, mode);
  assert.equal(result.candidatePool.length, 15);
  assert.equal(result.contextChronological.length, mode.exclusionCount + 1);
  assert.equal(result.observedFollowing.length, mode.exclusionCount);
  assert.equal(result.historyDrawCount, mode.historyWindow);
  assert.equal(result.pickCount, 2);
  assert.equal(result.targetDraw, null);
  assert.equal(result.contextChronological[0].period, start.period);

  const excludedSet = new Set(result.observedFollowing.flatMap(draw => draw.numbers));
  for (const item of result.survivors) assert.equal(excludedSet.has(item.number), false);
  for (const item of result.eliminatedCandidates) assert.equal(excludedSet.has(item.number), true);
  assert.equal(result.survivors.length + result.eliminatedCandidates.length, 15);

  // Verify the next issue is used only for historical comparison, not ranking.
  const historicalStart = draws[mode.exclusionCount + 1];
  const historicalResult = model.calculateFinalPrediction(draws, historicalStart.period, mode);
  assert.ok(historicalResult.targetDraw);
  assert.equal(historicalResult.targetDraw.period, draws[0].period);
  const changedTarget = draws.map(draw => ({ ...draw, numbers: draw.numbers.slice() }));
  changedTarget[0].numbers = [1, 2, 3, 4, 5];
  const recomputed = model.calculateFinalPrediction(changedTarget, historicalStart.period, mode);
  assert.deepEqual(
    historicalResult.candidatePool.map(item => [item.number, item.score]),
    recomputed.candidatePool.map(item => [item.number, item.score])
  );
}

assert.throws(() => model.calculateFinalPrediction(draws, draws[3].period, {
  historyWindow: 35, exclusionCount: 4, pickCount: 2
}), /只支援模式一/);
assert.throws(() => model.calculateFinalPrediction(draws, draws[0].period, {
  historyWindow: 35, exclusionCount: 3, pickCount: 2
}), /還需要3期/);
assert.throws(() => model.validateTriggers([1, 1, 2, 3, 4]), /不可重複/);
assert.equal(model.FIVE_DRAW_BASE_PROBABILITY > 0.49 && model.FIVE_DRAW_BASE_PROBABILITY < 0.50, true);
console.log('PASS: mode 1 (35/3) and mode 2 (49/4), two-number output, exclusions and target no-leakage.');
