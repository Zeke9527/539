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
const result = Model.buildPrediction({drawsNewestFirst:newestFirst, startIndex:4, historyAnchorPeriod:'115000070'});
const expected = {
  v781_full_p10: [25,30],
  v781_t49_p10: [30,17],
  v79_avgcount_t49_p50: [30,15]
};
for (const model of result.models) {
  assert.deepStrictEqual(model.picks, expected[model.id], `${model.id} prediction does not match sealed baseline`);
  assert.strictEqual(model.top15.length, 15);
  assert.ok(model.picks.every(n => !result.excludedNumbers.includes(n)));
  assert.ok(model.ranking.length === 39);
}
assert.strictEqual(result.d0.period, '115000266');
assert.strictEqual(result.targetPeriod, '115000271');
console.log('PASS: three models reproduce sealed 115000271 forecast; exclusions and ranking checks passed.');
