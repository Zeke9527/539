const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Model = require('../assets/model.js');

const csv = fs.readFileSync(path.join(__dirname, 'fixtures/history_sample_201.csv'), 'utf8').replace(/^\uFEFF/, '');
const rows = csv.trim().split(/\r?\n/).slice(1).map(line => {
  const [period, nums] = line.split(',');
  return { period, numbers: nums.trim().split(/\s+/).map(Number) };
});
const newestFirst = rows.slice().reverse();
const result = Model.buildPrediction({ drawsNewestFirst: newestFirst, startIndex: 4, historyAnchorPeriod: '115000070' });

assert.strictEqual(Model.VERSION, 'v7.9');
assert.strictEqual(result.modelId, 'v79_avgcount_t49_p50');
assert.strictEqual(result.d0.period, '115000266');
assert.strictEqual(result.targetPeriod, '115000271');
assert.strictEqual(result.historyCount, 49);
assert.strictEqual(result.transition.priorStrength, 50);
assert.deepStrictEqual(result.picks, [30, 15]);
assert.strictEqual(result.ranking.length, 39);
assert.strictEqual(result.top15.length, 15);
assert.ok(result.picks.every(number => !result.excludedNumbers.includes(number)));
assert.ok(result.picks.every(number => result.top15.some(item => item.number === number)));
assert.strictEqual(result.transition.perTrigger.length, 5);
assert.ok(result.transition.perTrigger.every(item => item.samples >= 0));
assert.strictEqual(result.survivors.length, result.top15.length - result.eliminated.length);
console.log('PASS: v7.9 Average Count T49/Prior50 reproduces sealed 115000271 prediction 30,15.');
