(function (root) {
  'use strict';

  const NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);
  const WINDOWS = [6, 12, 18, 24, 30, 60];
  const BASE_FIVE_PERIOD_PROBABILITY = 1 - Math.pow(34 / 39, 5);

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function standardize(values) {
    const avg = mean(values);
    const variance = mean(values.map(value => Math.pow(value - avg, 2)));
    const sd = Math.sqrt(variance);
    return values.map(value => sd === 0 ? 0 : (value - avg) / sd);
  }

  function validateTriggers(triggers) {
    if (!Array.isArray(triggers) || triggers.length !== 5) {
      throw new Error('請輸入剛好 5 個開獎號碼。');
    }
    const values = triggers.map(Number);
    if (values.some(n => !Number.isInteger(n) || n < 1 || n > 39)) {
      throw new Error('號碼必須是 01～39 的整數。');
    }
    if (new Set(values).size !== 5) throw new Error('5 個號碼不可重複。');
    return values.slice().sort((a, b) => a - b);
  }

  /**
   * drawsNewestFirst must be sorted newest -> oldest.
   * For a historical occurrence at index i, the next five chronological draws
   * are the five rows immediately before i in this descending array.
   * The newest row (index 0) is never treated as a completed trigger sample.
   */
  function calculateTransition(drawsNewestFirst, triggers, options) {
    const opts = Object.assign({ lookback: drawsNewestFirst.length, priorStrength: 10 }, options || {});
    const source = drawsNewestFirst.slice(0, Math.max(0, opts.lookback));
    const cleanTriggers = validateTriggers(triggers);
    const prior = BASE_FIVE_PERIOD_PROBABILITY;

    const perTrigger = cleanTriggers.map(trigger => {
      let samples = 0;
      const hitWindows = Object.fromEntries(NUMBERS.map(n => [n, 0]));

      for (let i = 5; i < source.length; i += 1) {
        const triggerDraw = source[i];
        if (!triggerDraw || !Array.isArray(triggerDraw.numbers) || !triggerDraw.numbers.includes(trigger)) continue;
        const followingFive = source.slice(i - 5, i);
        if (followingFive.length !== 5) continue;
        samples += 1;
        const appeared = new Set(followingFive.flatMap(draw => draw.numbers));
        for (const number of appeared) hitWindows[number] += 1;
      }

      const rates = {};
      for (const number of NUMBERS) {
        rates[number] = (hitWindows[number] + opts.priorStrength * prior) / (samples + opts.priorStrength);
      }
      return { trigger, samples, hitWindows, rates };
    });

    const scores = {};
    for (const number of NUMBERS) {
      scores[number] = mean(perTrigger.map(item => item.rates[number]));
    }

    return {
      priorProbability: prior,
      priorStrength: opts.priorStrength,
      perTrigger,
      scores,
      sampleCount: perTrigger.reduce((sum, item) => sum + item.samples, 0)
    };
  }

  function calculateSixWindow(drawsNewestFirst, options) {
    const opts = Object.assign({ windows: WINDOWS, shrinkage: 12 }, options || {});
    const usable = drawsNewestFirst;
    const details = {};
    const scores = Object.fromEntries(NUMBERS.map(n => [n, 0]));
    let usedWindows = 0;

    for (const length of opts.windows) {
      if (usable.length < length) continue;
      const sample = usable.slice(0, length);
      const counts = Object.fromEntries(NUMBERS.map(n => [n, 0]));
      for (const draw of sample) for (const number of draw.numbers) counts[number] += 1;
      const p = 5 / 39;
      const expected = length * p;
      const sd = Math.sqrt(length * p * (1 - p));
      const shrink = Math.sqrt(length / (length + opts.shrinkage));
      const zScores = {};
      for (const number of NUMBERS) {
        zScores[number] = ((counts[number] - expected) / sd) * shrink;
        scores[number] += zScores[number];
      }
      details[length] = { counts, zScores, shrink };
      usedWindows += 1;
    }

    for (const number of NUMBERS) scores[number] = usedWindows ? scores[number] / usedWindows : 0;
    return { scores, details, windowsUsed: Object.keys(details).map(Number), windowsRequested: opts.windows };
  }

  function analyze(drawsNewestFirst, triggers, numberCount, mode, options) {
    const count = Math.max(1, Math.min(5, Number(numberCount) || 3));
    const transition = calculateTransition(drawsNewestFirst, triggers, options && options.transition);
    const sixWindow = calculateSixWindow(drawsNewestFirst, options && options.sixWindow);
    const transitionValues = NUMBERS.map(n => transition.scores[n]);
    const sixValues = NUMBERS.map(n => sixWindow.scores[n]);
    const transitionZ = standardize(transitionValues);
    const sixZ = standardize(sixValues);
    const candidates = NUMBERS.map((number, index) => {
      let combinedScore;
      if (mode === 'six') combinedScore = sixZ[index];
      else if (mode === 'hybrid') combinedScore = 0.7 * transitionZ[index] + 0.3 * sixZ[index];
      else combinedScore = transitionZ[index];
      return {
        number,
        transitionRate: transition.scores[number],
        transitionZ: transitionZ[index],
        sixWindowScore: sixWindow.scores[number],
        sixWindowZ: sixZ[index],
        combinedScore,
        perTrigger: transition.perTrigger.map(item => ({
          trigger: item.trigger,
          samples: item.samples,
          hits: item.hitWindows[number],
          rate: item.rates[number]
        }))
      };
    }).sort((a, b) => b.combinedScore - a.combinedScore || b.transitionRate - a.transitionRate || a.number - b.number);

    return { triggers: validateTriggers(triggers), count, mode: mode || 'transition', transition, sixWindow, candidates, picks: candidates.slice(0, count) };
  }

  const api = {
    NUMBERS,
    WINDOWS,
    BASE_FIVE_PERIOD_PROBABILITY,
    validateTriggers,
    calculateTransition,
    calculateSixWindow,
    analyze
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.M539Model = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
