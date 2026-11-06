const assert = require('node:assert/strict');
const model = require('../assets/model.js');

function draw(numbers, period) { return { period: String(period), date: '2026-01-01', numbers }; }

// Input validation
assert.deepEqual(model.validateTriggers([29, 31, 33, 35, 38]), [29, 31, 33, 35, 38]);
assert.throws(() => model.validateTriggers([1, 2, 3, 4]), /剛好 5/);
assert.throws(() => model.validateTriggers([1, 2, 3, 4, 4]), /不可重複/);
assert.throws(() => model.validateTriggers([1, 2, 3, 4, 40]), /01～39/);

// Newest-first fixture: historical trigger 7 is followed chronologically by
// five more recent draws that all contain candidate 9 in at least one draw.
const fixture = [
  draw([9, 10, 11, 12, 13], 10),
  draw([1, 9, 14, 15, 16], 9),
  draw([2, 17, 18, 19, 20], 8),
  draw([3, 21, 22, 23, 24], 7),
  draw([4, 25, 26, 27, 28], 6),
  draw([7, 29, 30, 31, 32], 5),
  draw([5, 33, 34, 35, 36], 4),
  draw([6, 37, 38, 39, 8], 3)
];
const trans = model.calculateTransition(fixture, [7, 1, 2, 3, 4], { priorStrength: 10 });
assert.equal(trans.perTrigger.find(x => x.trigger === 7).samples, 1);
assert.ok(trans.scores[9] > model.BASE_FIVE_PERIOD_PROBABILITY);
assert.equal(trans.perTrigger.find(x => x.trigger === 7).hitWindows[9], 1);

// Six-window model uses only windows that are available.
const six = model.calculateSixWindow(fixture, { windows: [6, 12, 18, 24, 30, 60] });
assert.deepEqual(six.windowsUsed, [6]);
assert.equal(Object.keys(six.scores).length, 39);

const output = model.analyze(fixture, [7, 1, 2, 3, 4], 3, 'hybrid');
assert.equal(output.picks.length, 3);
assert.equal(new Set(output.picks.map(x => x.number)).size, 3);
assert.equal(output.candidates.length, 39);

console.log('539 model tests passed');
