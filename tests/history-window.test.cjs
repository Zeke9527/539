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
for (const mode of [{historyWindow:35, exclusionCount:3, pickCount:2}, {historyWindow:49, exclusionCount:4, pickCount:2}]) {
  const result = model.calculateFinalPrediction(draws, draws[mode.exclusionCount].period, mode);
  assert.equal(result.historyDrawCount, mode.historyWindow);
  assert.equal(result.historyWindow, mode.historyWindow);
  assert.equal(result.exclusionCount, mode.exclusionCount);
  assert.equal(result.pickCount, 2);
  assert.equal(result.contextChronological.length, mode.exclusionCount + 1);
  assert.equal(result.observedFollowing.length, mode.exclusionCount);
}
console.log('PASS: both preset training and exclusion windows.');
