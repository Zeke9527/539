(function (root) {
  'use strict';

  const NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);
  const WINDOWS = [6, 12, 18, 24, 30, 60];
  const ONE_DRAW_BASE_PROBABILITY = 5 / 39;
  const FIVE_DRAW_BASE_PROBABILITY = 1 - Math.pow(34 / 39, 5);

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
   * Legacy five-draw transition: P(B appears at least once in the next 5 draws | A appears now).
   * Kept for research comparison; it is not the same objective as next-draw prediction.
   */
  function calculateTransition(drawsNewestFirst, triggers, options) {
    const opts = Object.assign({ lookback: drawsNewestFirst.length, priorStrength: 10 }, options || {});
    const source = drawsNewestFirst.slice(0, Math.max(0, opts.lookback));
    const cleanTriggers = validateTriggers(triggers);
    const prior = FIVE_DRAW_BASE_PROBABILITY;

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
    for (const number of NUMBERS) scores[number] = mean(perTrigger.map(item => item.rates[number]));
    return {
      priorProbability: prior,
      priorStrength: opts.priorStrength,
      perTrigger,
      scores,
      sampleCount: perTrigger.reduce((sum, item) => sum + item.samples, 0)
    };
  }

  /**
   * Next-draw transition: P(B appears in the immediately following draw | A appears now).
   * drawsNewestFirst is sorted newest -> oldest, so the following chronological draw is i-1.
   */
  function calculateNextDrawTransition(drawsNewestFirst, triggers, options) {
    const opts = Object.assign({ lookback: drawsNewestFirst.length, priorStrength: 10 }, options || {});
    const source = drawsNewestFirst.slice(0, Math.max(0, opts.lookback));
    const cleanTriggers = validateTriggers(triggers);
    const prior = ONE_DRAW_BASE_PROBABILITY;

    const perTrigger = cleanTriggers.map(trigger => {
      let samples = 0;
      const hits = Object.fromEntries(NUMBERS.map(n => [n, 0]));
      for (let i = 1; i < source.length; i += 1) {
        const triggerDraw = source[i];
        if (!triggerDraw || !Array.isArray(triggerDraw.numbers) || !triggerDraw.numbers.includes(trigger)) continue;
        const nextDraw = source[i - 1];
        if (!nextDraw || !Array.isArray(nextDraw.numbers) || nextDraw.numbers.length !== 5) continue;
        samples += 1;
        for (const number of nextDraw.numbers) hits[number] += 1;
      }
      const rates = {};
      for (const number of NUMBERS) {
        rates[number] = (hits[number] + opts.priorStrength * prior) / (samples + opts.priorStrength);
      }
      return { trigger, samples, hits, rates };
    });

    const scores = {};
    for (const number of NUMBERS) scores[number] = mean(perTrigger.map(item => item.rates[number]));
    return {
      priorProbability: prior,
      priorStrength: opts.priorStrength,
      perTrigger,
      scores,
      sampleCount: perTrigger.reduce((sum, item) => sum + item.samples, 0)
    };
  }

  /**
   * Build the selected 5-draw context. The chosen start issue plus its four later
   * observed draws are returned newest -> oldest. A fifth-later target, if present,
   * is returned separately and is never used as an input feature.
   */
  function getFiveDayContext(drawsNewestFirst, startPeriod) {
    const source = drawsNewestFirst;
    const startIndex = source.findIndex(draw => String(draw.period) === String(startPeriod));
    if (startIndex < 0) throw new Error('找不到所選起始期別，請更新歷史資料。');
    if (startIndex < 4) throw new Error('所選起始期別後面尚未累積完整4期開獎資料。');
    const contextNewestFirst = source.slice(startIndex - 4, startIndex + 1);
    if (contextNewestFirst.length !== 5) throw new Error('無法取得完整的5期序列。');
    const targetDraw = startIndex >= 5 ? source[startIndex - 5] : null;
    return {
      startIndex,
      startDraw: source[startIndex],
      contextNewestFirst,
      contextChronological: contextNewestFirst.slice().reverse(),
      targetDraw
    };
  }

  /**
   * Fifth-day sequence model:
   * - Input: selected start draw + the following four already-drawn issues (5 draws total).
   * - Target: the immediately following, fifth draw after the start draw.
   * - Train only on historical samples whose target issue is older than the selected start issue.
   * - For each number A seen in a historical 5-draw context, learn the frequency of B in its next draw.
   * - Score the selected context by a recency-weighted average of its numbers' conditional rates.
   */
  function calculateFifthDaySequence(drawsNewestFirst, startPeriod, options) {
    const opts = Object.assign({ priorStrength: 12, recencyDecay: 0.72, minimumTrainingWindows: 20 }, options || {});
    const source = drawsNewestFirst;
    const selected = getFiveDayContext(source, startPeriod);
    const { startIndex, contextNewestFirst } = selected;
    const sampleCounts = Object.fromEntries(NUMBERS.map(n => [n, 0]));
    const hitCounts = Object.fromEntries(NUMBERS.map(n => [n, Object.fromEntries(NUMBERS.map(candidate => [candidate, 0]))]));
    let trainingWindows = 0;

    // j is the oldest draw in a historical 5-draw context; its target is j-5.
    // target index must be > startIndex, so no data at/after the selected start may leak into training.
    for (let j = startIndex + 6; j < source.length; j += 1) {
      const target = source[j - 5];
      const context = source.slice(j - 4, j + 1);
      if (!target || !Array.isArray(target.numbers) || target.numbers.length !== 5 || context.length !== 5) continue;
      if (context.some(draw => !draw || !Array.isArray(draw.numbers) || draw.numbers.length !== 5)) continue;
      trainingWindows += 1;
      const contextNumbers = new Set(context.flatMap(draw => draw.numbers));
      for (const trigger of contextNumbers) {
        sampleCounts[trigger] += 1;
        for (const candidate of target.numbers) hitCounts[trigger][candidate] += 1;
      }
    }

    if (trainingWindows < opts.minimumTrainingWindows) {
      throw new Error(`所選期別以前只有 ${trainingWindows} 組完整歷史訓練窗口；至少需要 ${opts.minimumTrainingWindows} 組，請選擇較新的起始期別或載入更多歷史資料。`);
    }

    const contextWeights = Object.fromEntries(NUMBERS.map(n => [n, 0]));
    // contextNewestFirst[0] is the most recent of the four subsequent draws.
    contextNewestFirst.forEach((draw, dayOffset) => {
      const weight = Math.pow(opts.recencyDecay, dayOffset);
      for (const number of draw.numbers) contextWeights[number] += weight;
    });
    const activeContextNumbers = NUMBERS.filter(n => contextWeights[n] > 0);

    const perContextNumber = activeContextNumbers.map(trigger => {
      const samples = sampleCounts[trigger];
      const rates = {};
      for (const candidate of NUMBERS) {
        rates[candidate] = (hitCounts[trigger][candidate] + opts.priorStrength * ONE_DRAW_BASE_PROBABILITY) /
          (samples + opts.priorStrength);
      }
      return { trigger, weight: contextWeights[trigger], samples, hits: hitCounts[trigger], rates };
    });

    const totalWeight = perContextNumber.reduce((sum, item) => sum + item.weight, 0);
    const scores = {};
    for (const candidate of NUMBERS) {
      scores[candidate] = totalWeight
        ? perContextNumber.reduce((sum, item) => sum + item.weight * item.rates[candidate], 0) / totalWeight
        : ONE_DRAW_BASE_PROBABILITY;
    }

    const candidates = NUMBERS.map(number => ({
      number,
      score: scores[number],
      contextSupport: perContextNumber.map(item => ({
        trigger: item.trigger,
        weight: item.weight,
        samples: item.samples,
        hits: item.hits[number],
        rate: item.rates[number]
      }))
    })).sort((a, b) => b.score - a.score || a.number - b.number);

    return {
      startPeriod: selected.startDraw.period,
      startDate: selected.startDraw.date,
      startIndex,
      contextNewestFirst,
      contextChronological: selected.contextChronological,
      targetDraw: selected.targetDraw,
      trainingWindows,
      priorProbability: ONE_DRAW_BASE_PROBABILITY,
      priorStrength: opts.priorStrength,
      recencyDecay: opts.recencyDecay,
      candidates,
      contextNumberCount: activeContextNumbers.length,
      contextNumbers: perContextNumber.map(item => ({ trigger: item.trigger, weight: item.weight, samples: item.samples }))
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
    const nextDraw = calculateNextDrawTransition(drawsNewestFirst, triggers, options && options.transition);
    const sixWindow = calculateSixWindow(drawsNewestFirst, options && options.sixWindow);
    const nextValues = NUMBERS.map(n => nextDraw.scores[n]);
    const sixValues = NUMBERS.map(n => sixWindow.scores[n]);
    const nextZ = standardize(nextValues);
    const sixZ = standardize(sixValues);
    const candidates = NUMBERS.map((number, index) => {
      let combinedScore;
      if (mode === 'six') combinedScore = sixZ[index];
      else if (mode === 'hybrid') combinedScore = 0.7 * nextZ[index] + 0.3 * sixZ[index];
      else combinedScore = nextZ[index];
      return {
        number,
        nextDrawRate: nextDraw.scores[number],
        nextDrawZ: nextZ[index],
        sixWindowScore: sixWindow.scores[number],
        sixWindowZ: sixZ[index],
        combinedScore,
        perTrigger: nextDraw.perTrigger.map(item => ({
          trigger: item.trigger,
          samples: item.samples,
          hits: item.hits[number],
          rate: item.rates[number]
        }))
      };
    }).sort((a, b) => b.combinedScore - a.combinedScore || b.nextDrawRate - a.nextDrawRate || a.number - b.number);

    return {
      triggers: validateTriggers(triggers),
      count,
      mode: mode || 'next',
      nextDraw,
      sixWindow,
      candidates,
      picks: candidates.slice(0, count)
    };
  }

  const api = {
    NUMBERS,
    WINDOWS,
    ONE_DRAW_BASE_PROBABILITY,
    FIVE_DRAW_BASE_PROBABILITY,
    validateTriggers,
    calculateTransition,
    calculateNextDrawTransition,
    getFiveDayContext,
    calculateFifthDaySequence,
    calculateSixWindow,
    analyze
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.M539Model = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
