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
const result = model.calculateFinalPrediction(draws, draws[4].period, {historyWindow:36});
assert.equal(result.historyDrawCount, 36);
assert.equal(result.historyWindow, 36);
assert.equal(result.trainingRange.newest.period, draws[5].period);
assert.equal(result.candidatePool.length, 15);
assert.equal(result.observedFollowingFour.length, 4);
assert.throws(() => model.calculateFinalPrediction(draws, draws[4].period, {historyWindow:24}), /固定使用最近36期/);
console.log('PASS: fixed 36-draw training window and D1-D4 elimination.');
