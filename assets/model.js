(function (root) {
  'use strict';

  const NUMBERS = Array.from({ length: 39 }, (_, index) => index + 1);
  const FIVE_DRAW_BASE_PROBABILITY = 1 - Math.pow(34 / 39, 5);
  const SUPPORTED_HISTORY_WINDOWS = [35, 49];
  const SUPPORTED_EXCLUSION_COUNTS = [3, 4];

  function pad2(value) { return String(value).padStart(2, '0'); }

  function validateTriggers(triggers) {
    if (!Array.isArray(triggers) || triggers.length !== 5) {
      throw new Error('起始期必須有5個開獎號碼。');
    }
    const numbers = triggers.map(Number);
    if (numbers.some(number => !Number.isInteger(number) || number < 1 || number > 39)) {
      throw new Error('開獎號碼必須介於01～39。');
    }
    if (new Set(numbers).size !== 5) throw new Error('開獎號碼不可重複。');
    return numbers.slice().sort((a, b) => a - b);
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  /**
   * History is newest-first. For each historical trigger draw, inspect the five
   * chronologically following draws and count whether each candidate appeared
   * at least once in that five-draw window.
   */
  function calculateFiveDrawTransition(historyNewestFirst, triggers, priorStrength) {
    const strength = Number.isFinite(Number(priorStrength)) ? Math.max(0, Number(priorStrength)) : 10;
    const cleanTriggers = validateTriggers(triggers);
    const perTrigger = cleanTriggers.map(trigger => {
      let samples = 0;
      const hitWindows = Object.fromEntries(NUMBERS.map(number => [number, 0]));

      for (let index = 5; index < historyNewestFirst.length; index += 1) {
        const triggerDraw = historyNewestFirst[index];
        if (!triggerDraw.numbers.includes(trigger)) continue;
        const followingFive = historyNewestFirst.slice(index - 5, index);
        if (followingFive.length !== 5) continue;
        samples += 1;
        const appeared = new Set(followingFive.flatMap(draw => draw.numbers));
        for (const number of appeared) hitWindows[number] += 1;
      }

      const rates = {};
      for (const number of NUMBERS) {
        rates[number] = (hitWindows[number] + strength * FIVE_DRAW_BASE_PROBABILITY) / (samples + strength);
      }
      return { trigger, samples, hitWindows, rates };
    });

    const scores = {};
    for (const number of NUMBERS) scores[number] = mean(perTrigger.map(item => item.rates[number]));
    return {
      priorProbability: FIVE_DRAW_BASE_PROBABILITY,
      priorStrength: strength,
      perTrigger,
      scores,
      sampleCount: perTrigger.reduce((sum, item) => sum + item.samples, 0)
    };
  }

  /**
   * Two fixed modes are supported:
   * Mode 1: train on 35 draws, exclude D1-D3, output top 2 survivors.
   * Mode 2: train on 49 draws, exclude D1-D4, output top 2 survivors.
   * Input draws must be sorted newest-first.
   */
  function calculateFinalPrediction(drawsNewestFirst, startPeriod, options) {
    const settings = Object.assign({
      candidatePoolSize: 15,
      priorStrength: 10,
      historyWindow: 35,
      exclusionCount: 3,
      pickCount: 2
    }, options || {});

    const historyWindow = Number(settings.historyWindow);
    const exclusionCount = Number(settings.exclusionCount);
    const pickCount = Number(settings.pickCount);
    const candidatePoolSize = Number(settings.candidatePoolSize);

    const supportedMode = (historyWindow === 35 && exclusionCount === 3) || (historyWindow === 49 && exclusionCount === 4);
    if (!supportedMode) {
      throw new Error('只支援模式一（訓練35期、排除3期）或模式二（訓練49期、排除4期）。');
    }
    if (pickCount !== 2 || candidatePoolSize !== 15) {
      throw new Error('本版本固定從TOP 15候選中選出2碼。');
    }

    const startIndex = drawsNewestFirst.findIndex(draw => String(draw.period) === String(startPeriod));
    if (startIndex < 0) throw new Error('找不到選定期別，請更新資料。');
    if (startIndex < exclusionCount) {
      const available = startIndex;
      throw new Error(`這一期之後目前只有${available}期資料，還需要${exclusionCount - available}期，才能完成排除後${exclusionCount}期。`);
    }

    const startDraw = drawsNewestFirst[startIndex];
    const allHistoryBeforeStart = drawsNewestFirst.slice(startIndex + 1);
    if (allHistoryBeforeStart.length < historyWindow) {
      throw new Error(`起始期以前只有${allHistoryBeforeStart.length}期歷史資料，選擇${historyWindow}期訓練至少需要${historyWindow}期。`);
    }
    const historyBeforeStart = allHistoryBeforeStart.slice(0, historyWindow);
    if (historyBeforeStart.some(draw => !draw || !Array.isArray(draw.numbers) || draw.numbers.length !== 5)) {
      throw new Error('起始期以前的歷史資料有缺漏或格式錯誤，請重新更新資料。');
    }

    const transition = calculateFiveDrawTransition(historyBeforeStart, startDraw.numbers, settings.priorStrength);
    const trainingRange = {
      newest: historyBeforeStart[0],
      oldest: historyBeforeStart[historyBeforeStart.length - 1]
    };
    const candidatePool = NUMBERS
      .map(number => ({ number, score: transition.scores[number] }))
      .sort((a, b) => b.score - a.score || a.number - b.number)
      .slice(0, candidatePoolSize)
      .map((item, index) => ({ ...item, originalRank: index + 1 }));

    // Include D0 through Dn in chronological order; only D1..Dn are excluded.
    const contextChronological = drawsNewestFirst
      .slice(startIndex - exclusionCount, startIndex + 1)
      .reverse();
    if (contextChronological.length !== exclusionCount + 1) {
      throw new Error(`無法取得起始期與後續${exclusionCount}期的完整資料。`);
    }
    const observedFollowing = contextChronological.slice(1);
    const exclusions = new Map();

    for (const draw of observedFollowing) {
      for (const number of draw.numbers) {
        if (!exclusions.has(number)) exclusions.set(number, []);
        exclusions.get(number).push({ period: draw.period, date: draw.date });
      }
    }

    const eliminatedCandidates = candidatePool
      .filter(item => exclusions.has(item.number))
      .map(item => ({ ...item, appearedIn: exclusions.get(item.number) }));
    const survivors = candidatePool
      .filter(item => !exclusions.has(item.number))
      .map((item, index) => ({ ...item, finalRank: index + 1 }));

    // The target is D(n+1). It is only used for historical verification, never scoring.
    const targetDraw = startIndex > exclusionCount
      ? drawsNewestFirst[startIndex - exclusionCount - 1]
      : null;
    const targetSet = targetDraw ? new Set(targetDraw.numbers) : null;
    const originalHits = targetSet ? candidatePool.filter(item => targetSet.has(item.number)).map(item => item.number) : null;
    const survivorHits = targetSet ? survivors.filter(item => targetSet.has(item.number)).map(item => item.number) : null;

    return {
      startDraw,
      startPeriod: startDraw.period,
      startDate: startDraw.date,
      startIndex,
      historyDrawCount: historyBeforeStart.length,
      historyWindow,
      exclusionCount,
      pickCount,
      trainingRange,
      contextChronological,
      observedFollowing,
      targetDraw,
      transition,
      candidatePool,
      eliminatedCandidates,
      excludedNumbers: Array.from(exclusions.keys()).sort((a, b) => a - b),
      survivors,
      originalHits,
      survivorHits
    };
  }

  const api = {
    NUMBERS,
    FIVE_DRAW_BASE_PROBABILITY,
    SUPPORTED_HISTORY_WINDOWS,
    SUPPORTED_EXCLUSION_COUNTS,
    pad2,
    validateTriggers,
    calculateFiveDrawTransition,
    calculateFinalPrediction
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.M539FinalModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
