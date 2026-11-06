const assert = require('node:assert/strict');
const model = require('../assets/model.js');

function draw(numbers, period, date = '2026-01-01') { return { period: String(period), date, numbers: numbers.slice().sort((a, b) => a - b) }; }

// Input validation
assert.deepEqual(model.validateTriggers([29, 31, 33, 35, 38]), [29, 31, 33, 35, 38]);
assert.throws(() => model.validateTriggers([1, 2, 3, 4]), /剛好 5/);
assert.throws(() => model.validateTriggers([1, 2, 3, 4, 4]), /不可重複/);
assert.throws(() => model.validateTriggers([1, 2, 3, 4, 40]), /01～39/);

// Historical trigger 7 is followed immediately by a draw containing 9.
const fixture = [
  draw([9, 10, 11, 12, 13], 10),
  draw([1, 9, 14, 15, 16], 9),
  draw([7, 17, 18, 19, 20], 8),
  draw([3, 21, 22, 23, 24], 7),
  draw([4, 25, 26, 27, 28], 6),
  draw([7, 33, 34, 35, 36], 5),
  draw([6, 37, 38, 39, 8], 4)
];
const next = model.calculateNextDrawTransition(fixture, [7, 1, 2, 3, 4], { priorStrength: 1 });
assert.equal(next.perTrigger.find(x => x.trigger === 7).samples, 2);
assert.ok(next.scores[9] > model.ONE_DRAW_BASE_PROBABILITY);
assert.equal(next.perTrigger.find(x => x.trigger === 7).hits[9], 1);

// Legacy five-draw probability is still available for comparison.
const legacy = model.calculateTransition(fixture, [7, 1, 2, 3, 4], { priorStrength: 10 });
assert.equal(legacy.perTrigger.find(x => x.trigger === 7).samples, 1);
assert.ok(legacy.scores[9] > model.FIVE_DRAW_BASE_PROBABILITY);

// Build a synthetic 50-draw history. All rows are newest -> oldest.
const history = Array.from({ length: 50 }, (_, index) => {
  const base = (index * 7) % 39 + 1;
  const nums = [base, ((base + 5) % 39) + 1, ((base + 11) % 39) + 1, ((base + 17) % 39) + 1, ((base + 23) % 39) + 1];
  return draw(nums, 115000300 - index, `2026-10-${String(31 - (index % 28)).padStart(2, '0')}`);
});

// Next-draw and six-window model output shape.
const six = model.calculateSixWindow(history, { windows: [6, 12, 18, 24, 30, 60] });
assert.deepEqual(six.windowsUsed, [6, 12, 18, 24, 30]);
assert.equal(Object.keys(six.scores).length, 39);
const output = model.analyze(history, history[0].numbers, 3, 'hybrid');
assert.equal(output.picks.length, 3);
assert.equal(new Set(output.picks.map(x => x.number)).size, 3);
assert.equal(output.candidates.length, 39);

// Fifth-day sequence forecast: start at the fifth newest draw, then use four newer draws.
const start = history[4];
const fifth = model.calculateFifthDaySequence(history, start.period, { minimumTrainingWindows: 20 });
assert.equal(fifth.contextChronological.length, 5);
assert.equal(fifth.contextChronological[0].period, start.period);
assert.equal(fifth.contextChronological[4].period, history[0].period);
assert.equal(fifth.targetDraw, null); // the fifth-later result has not happened yet
assert.equal(fifth.trainingWindows, 40);
assert.equal(fifth.candidates.length, 39);
assert.ok(fifth.candidates[0].score >= fifth.candidates[38].score);

// Selecting an older start yields a known fifth-day result, but that target is excluded from training.
const olderStart = history[5];
const historical = model.calculateFifthDaySequence(history, olderStart.period, { minimumTrainingWindows: 20 });
assert.equal(historical.targetDraw.period, history[0].period);
assert.equal(historical.trainingWindows, 39);
const changedTargetHistory = history.map((item, index) => index === 0 ? draw([1, 2, 3, 4, 5], item.period, item.date) : item);
const historicalAfterTargetMutation = model.calculateFifthDaySequence(changedTargetHistory, olderStart.period, { minimumTrainingWindows: 20 });
assert.deepEqual(historical.candidates.map(x => [x.number, x.score]), historicalAfterTargetMutation.candidates.map(x => [x.number, x.score]));

assert.throws(() => model.calculateFifthDaySequence(history, history[0].period), /後面尚未累積完整4期/);


// Four-draw elimination: rank from history before D0, then remove candidates seen in D1..D4.
const exclusionHistory = [
  draw([1, 2, 3, 4, 5], 115000500),       // D5 target
  draw([6, 7, 8, 9, 10], 115000499),    // D4
  draw([11, 12, 13, 14, 15], 115000498),// D3
  draw([16, 17, 18, 19, 20], 115000497),// D2
  draw([21, 22, 23, 24, 25], 115000496),// D1
  draw([35, 36, 37, 38, 39], 115000495),// D0
  ...Array.from({ length: 60 }, (_, index) => {
    const base = (index * 9) % 39 + 1;
    const values = Array.from({ length: 5 }, (_, offset) => ((base + offset * 7 - 1) % 39) + 1);
    return draw([...new Set(values)].slice(0, 5), 115000494 - index);
  })
];
const exclusion = model.calculateFourDrawElimination(exclusionHistory, '115000495', { candidatePoolSize: 39 });
assert.equal(exclusion.contextChronological.length, 5);
assert.deepEqual(exclusion.contextChronological.map(x => x.period), ['115000495','115000496','115000497','115000498','115000499']);
assert.deepEqual(exclusion.excludedNumbers, Array.from({ length: 20 }, (_, index) => index + 6));
assert.ok(exclusion.candidatePool.filter(x => x.number >= 6 && x.number <= 25).every(x => exclusion.eliminatedCandidates.some(y => y.number === x.number)));
assert.ok(exclusion.candidatePool.filter(x => x.number <= 5).every(x => exclusion.survivors.some(y => y.number === x.number)), 'D5 target numbers are not part of the elimination window');
assert.ok(exclusion.candidatePool.filter(x => x.number >= 35).every(x => exclusion.survivors.some(y => y.number === x.number)), 'D0-only numbers must not be excluded');
assert.equal(exclusion.targetDraw.period, '115000500');
const changedExclusionTarget = exclusionHistory.map((item, index) => index === 0 ? draw([30, 31, 32, 33, 34], item.period, item.date) : item);
const changedExclusion = model.calculateFourDrawElimination(changedExclusionTarget, '115000495', { candidatePoolSize: 39 });
assert.deepEqual(exclusion.candidatePool.map(x => [x.number, x.score]), changedExclusion.candidatePool.map(x => [x.number, x.score]), 'fifth-draw result must not leak into ranking');
assert.deepEqual(exclusion.survivors.map(x => x.number), changedExclusion.survivors.map(x => x.number));


// Reproduce the supplied 115000264 example using its manually ranked 12 candidates.
const userExampleHistory = [
  draw([14, 20, 23, 26, 29], 115000269),
  draw([20, 28, 32, 36, 37], 115000268),
  draw([2, 8, 18, 33, 39], 115000267),
  draw([5, 10, 30, 32, 34], 115000266),
  draw([29, 31, 33, 35, 38], 115000265),
  draw([2, 5, 17, 28, 37], 115000264),
  ...Array.from({ length: 60 }, (_, index) => {
    const base = (index * 11) % 39 + 1;
    const values = Array.from({ length: 5 }, (_, offset) => ((base + offset * 5 - 1) % 39) + 1);
    return draw([...new Set(values)].slice(0, 5), 115000263 - index);
  })
];
const userExampleRanking = [14, 19, 5, 31, 34, 2, 38, 30, 29, 7, 12, 28];
const userExample = model.calculateFourDrawElimination(userExampleHistory, '115000264', {
  candidatePoolSize: 12,
  candidateNumbers: userExampleRanking
});
assert.deepEqual(userExample.candidatePool.map(x => x.number), userExampleRanking);
assert.deepEqual(userExample.eliminatedCandidates.map(x => x.number), [5, 31, 34, 2, 38, 30, 29, 28]);
assert.deepEqual(userExample.survivors.map(x => x.number), [14, 19, 7, 12]);
assert.deepEqual(userExample.originalHits, [14, 29]);
assert.deepEqual(userExample.survivorHits, [14]);

console.log('539 v6.1 model tests passed');
