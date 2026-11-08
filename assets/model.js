/* 539 DATA LAB v7.9
 * 唯一正式運行模型：Average Count / T49 / Prior50 / TOP15 / D1-D4 / 前2碼
 * 訓練資料只取 D0 以前最近49期；每個 D0 觸發號碼等權。
 */
(function (root) {
  'use strict';

  const VERSION = 'v7.9';
  const NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);
  const TRAIN_WINDOW = 49;
  const PRIOR_STRENGTH = 50;
  const PRIOR_SINGLE_DRAW_RATE = 5 / 39;
  const TOP_K = 15;
  const PICK_COUNT = 2;
  const EXCLUDE_DRAWS = 4;

  function validateDraw(draw) {
    if (!draw || !Array.isArray(draw.numbers) || draw.numbers.length !== 5) {
      throw new Error('開獎資料格式錯誤：每期必須有5個號碼。');
    }
    const numbers = draw.numbers.map(Number);
    if (numbers.some(n => !Number.isInteger(n) || n < 1 || n > 39) || new Set(numbers).size !== 5) {
      throw new Error('開獎號碼必須為01～39且不得重複。');
    }
    return { ...draw, period: String(draw.period), numbers: numbers.slice().sort((a, b) => a - b) };
  }

  function validateTriggers(triggers) {
    if (!Array.isArray(triggers) || triggers.length !== 5) throw new Error('D0必須包含5個觸發號碼。');
    const numbers = triggers.map(Number);
    if (numbers.some(n => !Number.isInteger(n) || n < 1 || n > 39) || new Set(numbers).size !== 5) {
      throw new Error('D0觸發號碼必須為01～39且不得重複。');
    }
    return numbers.slice().sort((a, b) => a - b);
  }

  function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  /**
   * Average Count score.
   * historyNewestFirst must contain only draws before D0, newest first.
   * For each historical occurrence of trigger t, count all appearances of
   * candidate j in the following five chronological draws.
   * rate(t,j) = (count + 50*(5/39)) / (5*samples + 50)
   */
  function calculateAverageCount(historyNewestFirst, triggers) {
    if (!Array.isArray(historyNewestFirst) || historyNewestFirst.length < TRAIN_WINDOW) {
      throw new Error(`v7.9需要D0以前至少${TRAIN_WINDOW}期歷史資料。`);
    }
    const cleanTriggers = validateTriggers(triggers);
    const history = historyNewestFirst.slice(0, TRAIN_WINDOW).map(validateDraw);
    const perTrigger = cleanTriggers.map(trigger => {
      let samples = 0;
      const counts = Object.fromEntries(NUMBERS.map(number => [number, 0]));

      // The oldest four/five records do not have five known subsequent draws;
      // therefore each trigger event is counted only when its complete window exists.
      for (let index = 5; index < history.length; index += 1) {
        if (!history[index].numbers.includes(trigger)) continue;
        const followingFive = history.slice(index - 5, index);
        if (followingFive.length !== 5) continue;
        samples += 1;
        followingFive.forEach(draw => draw.numbers.forEach(number => { counts[number] += 1; }));
      }

      const rates = {};
      NUMBERS.forEach(number => {
        rates[number] = (counts[number] + PRIOR_STRENGTH * PRIOR_SINGLE_DRAW_RATE) /
          (5 * samples + PRIOR_STRENGTH);
      });
      return { trigger, samples, counts, rates };
    });

    const scores = {};
    NUMBERS.forEach(number => { scores[number] = average(perTrigger.map(item => item.rates[number])); });
    return {
      type: 'average_count',
      trainWindow: TRAIN_WINDOW,
      priorStrength: PRIOR_STRENGTH,
      priorProbability: PRIOR_SINGLE_DRAW_RATE,
      perTrigger,
      scores,
      sampleCount: perTrigger.reduce((sum, item) => sum + item.samples, 0)
    };
  }

  function rankScores(scores) {
    return NUMBERS
      .map(number => ({ number, score: scores[number] }))
      .sort((a, b) => b.score - a.score || a.number - b.number)
      .map((item, index) => ({ ...item, originalRank: index + 1 }));
  }

  function buildPrediction({ drawsNewestFirst, startIndex = 4, historyAnchorPeriod = '115000070' }) {
    if (!Array.isArray(drawsNewestFirst) || drawsNewestFirst.length < TRAIN_WINDOW + EXCLUDE_DRAWS + 1) {
      throw new Error(`目前有效開獎資料不足，v7.9至少需要${TRAIN_WINDOW + EXCLUDE_DRAWS + 1}期。`);
    }
    if (startIndex !== EXCLUDE_DRAWS) throw new Error('v7.9固定使用最新資料倒數第5期作為D0。');

    const draws = drawsNewestFirst.map(validateDraw);
    const d0 = draws[startIndex];
    const d1ToD4 = draws.slice(0, EXCLUDE_DRAWS).reverse(); // chronological D1 -> D4
    if (d1ToD4.length !== EXCLUDE_DRAWS) throw new Error('尚未取得完整D1～D4，暫時不能預測D5。');

    const historyBeforeD0 = draws.slice(startIndex + 1)
      .filter(draw => Number(draw.period) >= Number(historyAnchorPeriod));
    if (historyBeforeD0.length < TRAIN_WINDOW) {
      throw new Error(`D0以前可用歷史只有${historyBeforeD0.length}期，v7.9需要至少49期。`);
    }
    const trainingHistory = historyBeforeD0.slice(0, TRAIN_WINDOW);
    const transition = calculateAverageCount(trainingHistory, d0.numbers);
    const ranking = rankScores(transition.scores);
    const top15 = ranking.slice(0, TOP_K);
    const excludedNumbers = Array.from(new Set(d1ToD4.flatMap(draw => draw.numbers))).sort((a, b) => a - b);
    const excluded = new Set(excludedNumbers);
    const excludedMap = new Map();
    d1ToD4.forEach(draw => draw.numbers.forEach(number => {
      if (!excludedMap.has(number)) excludedMap.set(number, []);
      excludedMap.get(number).push({ period: draw.period, date: draw.date });
    }));
    const eliminated = top15.filter(item => excluded.has(item.number)).map(item => ({
      ...item,
      appearedIn: excludedMap.get(item.number) || []
    }));
    const survivors = top15.filter(item => !excluded.has(item.number))
      .map((item, index) => ({ ...item, finalRank: index + 1 }));
    const targetPeriod = nextPeriodLabel(draws[0]);

    return {
      version: VERSION,
      modelId: 'v79_avgcount_t49_p50',
      modelName: '539 v7.9 · Average Count',
      modelSubtitle: 'T49 · Prior50 · TOP15 · 排除D1～D4 · 固定選2碼',
      d0,
      d1ToD4,
      latestDraw: draws[0],
      targetPeriod,
      dataCount: draws.length,
      historyAnchorPeriod: String(historyAnchorPeriod),
      historyCount: trainingHistory.length,
      historyStart: trainingHistory[trainingHistory.length - 1].period,
      historyEnd: trainingHistory[0].period,
      trainingHistory,
      excludedNumbers,
      transition,
      ranking,
      top15,
      eliminated,
      survivors,
      picks: survivors.slice(0, PICK_COUNT).map(item => item.number),
      scoreMap: transition.scores
    };
  }

  function nextPeriodLabel(latestDraw) {
    const period = String(latestDraw.period || '');
    if (!/^\d{9}$/.test(period)) return '下一期（期別待公布）';
    const rocYear = Number(period.slice(0, 3));
    const sequence = Number(period.slice(3));
    // Daily539 period sequence is reset at a ROC-year boundary. Until the
    // calendar rollover is reached, display the next sequence; at year end,
    // keep a neutral label rather than inventing a period identifier.
    if (latestDraw.date && /^\d{4}-\d{2}-\d{2}$/.test(latestDraw.date)) {
      const latestDate = new Date(`${latestDraw.date}T12:00:00+08:00`);
      const nextDate = new Date(latestDate.getTime() + 24 * 60 * 60 * 1000);
      const nextRocYear = nextDate.getFullYear() - 1911;
      if (Number.isFinite(nextRocYear) && nextRocYear !== rocYear) return '下一年度期別（待公布）';
    }
    return `${period.slice(0, 3)}${String(sequence + 1).padStart(6, '0')}`;
  }

  const api = {
    VERSION, NUMBERS, TRAIN_WINDOW, PRIOR_STRENGTH, TOP_K, PICK_COUNT, EXCLUDE_DRAWS,
    calculateAverageCount, rankScores, buildPrediction
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.M539V79Model = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
