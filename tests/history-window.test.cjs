const assert = require('node:assert/strict');
const model = require('../assets/model.js');
function makeDraws(count = 100) {
  let state = 539;
  const random = () => ((state = (state * 48271) % 2147483647) - 1) / 2147483646;
  return Array.from({length: count}, (_, i) => {
    const set = new Set(); while (set.size < 5) set.add(1 + Math.floor(random() * 39));
    return {period:String(115000001+i),date:`2026-01-${String(i%28+1).padStart(2,'0')}`,numbers:[...set].sort((a,b)=>a-b)};
  }).reverse();
}
const draws = makeDraws();
assert.deepEqual(model.SUPPORTED_HISTORY_WINDOWS, [12, 18]);
for (const historyWindow of [12, 18]) {
  const result = model.calculateFinalPrediction(draws, draws[4].period, {historyWindow});
  assert.equal(result.historyDrawCount, historyWindow);
  assert.equal(result.historyWindow, historyWindow);
  assert.equal(result.trainingRange.newest.period, draws[5].period);
  assert.equal(result.trainingRange.oldest.period, draws[4 + historyWindow].period);
  assert.equal(result.candidatePool.length, 15);
  assert.equal(result.observedFollowingFour.length, 4);
}
assert.throws(() => model.calculateFinalPrediction(draws, draws[4].period, {historyWindow:24}), /只能選擇12期或18期/);
console.log('PASS: selectable 12/18-draw training windows with D1-D4 elimination.');
