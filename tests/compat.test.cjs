const assert = require('node:assert/strict');
const oldModel = require('../../539-data-lab-v6.1/assets/model.js');
const newModel = require('../assets/model.js');

function makeDraws(count = 240) {
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
      period: String(115000001 + index), date,
      numbers: Array.from(values).sort((a, b) => a - b)
    });
  }
  return draws.reverse();
}

const draws = makeDraws();
const start = draws[4];
const oldResult = oldModel.calculateFourDrawElimination(draws, start.period, {
  candidatePoolSize: 15, priorStrength: 10
});
const newResult = newModel.calculateFinalPrediction(draws, start.period, {
  candidatePoolSize: 15, priorStrength: 10
});
assert.deepEqual(
  newResult.candidatePool.map(x => [x.number, x.score]),
  oldResult.candidatePool.map(x => [x.number, x.score]),
  'v7.1 must reproduce v6.1 ranking and scores when given identical 200-draw history'
);
assert.deepEqual(
  newResult.survivors.map(x => x.number),
  oldResult.survivors.map(x => x.number),
  'v7.1 must reproduce v6.1 D1-D4 exclusion survivors'
);
console.log('PASS: v7.1 exactly reproduces v6.1 scores, ranking and D1-D4 exclusion on identical historical data.');
