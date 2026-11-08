/* 539 三模型即時預測引擎
 * 三種固定模型：
 * 1) v7.8.1 全歷史／Prior10：any-hit in next 5 draws
 * 2) v7.8.1 T49／Prior10：same method, last 49 history draws
 * 3) v7.9-shadow Average Count T49／Prior50：total appearances across next 5 draws
 * All models: equal-weight 5 D0 triggers, TOP15, exclude D1-D4, pick top 2 survivors.
 */
(function (root) {
  'use strict';

  const NUMBERS = Array.from({ length: 39 }, (_, i) => i + 1);
  const P5_ANY = 1 - Math.pow(34 / 39, 5);
  const P_SINGLE = 5 / 39;
  const TOP_K = 15;
  const PICK_COUNT = 2;

  function validateDraw(draw) {
    if (!draw || !Array.isArray(draw.numbers) || draw.numbers.length !== 5) {
      throw new Error('開獎資料格式錯誤：每期必須有5個號碼。');
    }
    const ns = draw.numbers.map(Number);
    if (ns.some(n => !Number.isInteger(n) || n < 1 || n > 39) || new Set(ns).size !== 5) {
      throw new Error('開獎號碼必須是01～39之間不重複的5個整數。');
    }
    return { ...draw, numbers: ns.slice().sort((a, b) => a - b) };
  }

  function normalizeTriggers(triggers) {
    if (!Array.isArray(triggers) || triggers.length !== 5) throw new Error('D0必須包含5個觸發號碼。');
    const nums = triggers.map(Number);
    if (nums.some(n => !Number.isInteger(n) || n < 1 || n > 39) || new Set(nums).size !== 5) {
      throw new Error('觸發號碼必須為01～39且不得重複。');
    }
    return nums.slice().sort((a, b) => a - b);
  }

  function average(values) {
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  }

  // historyNewestFirst contains only draws older than D0, newest first.
  function calculateAnyHit(historyNewestFirst, triggers, priorStrength) {
    const cleanTriggers = normalizeTriggers(triggers);
    const prior = Number(priorStrength);
    const strength = Number.isFinite(prior) && prior >= 0 ? prior : 10;
    const perTrigger = cleanTriggers.map(trigger => {
      let samples = 0;
      const counts = Object.fromEntries(NUMBERS.map(n => [n, 0]));
      for (let i = 5; i < historyNewestFirst.length; i += 1) {
        if (!historyNewestFirst[i].numbers.includes(trigger)) continue;
        const followingFive = historyNewestFirst.slice(i - 5, i);
        if (followingFive.length !== 5) continue;
        samples += 1;
        const union = new Set(followingFive.flatMap(d => d.numbers));
        union.forEach(n => { counts[n] += 1; });
      }
      const rates = {};
      NUMBERS.forEach(n => {
        rates[n] = (counts[n] + strength * P5_ANY) / (samples + strength);
      });
      return { trigger, samples, counts, rates };
    });
    const scores = {};
    NUMBERS.forEach(n => { scores[n] = average(perTrigger.map(x => x.rates[n])); });
    return { type: 'any_hit', priorStrength: strength, priorProbability: P5_ANY, perTrigger, scores,
      sampleCount: perTrigger.reduce((s, x) => s + x.samples, 0) };
  }

  function calculateAverageCount(historyNewestFirst, triggers, priorStrength) {
    const cleanTriggers = normalizeTriggers(triggers);
    const prior = Number(priorStrength);
    const strength = Number.isFinite(prior) && prior >= 0 ? prior : 50;
    const perTrigger = cleanTriggers.map(trigger => {
      let samples = 0;
      const counts = Object.fromEntries(NUMBERS.map(n => [n, 0]));
      for (let i = 5; i < historyNewestFirst.length; i += 1) {
        if (!historyNewestFirst[i].numbers.includes(trigger)) continue;
        const followingFive = historyNewestFirst.slice(i - 5, i);
        if (followingFive.length !== 5) continue;
        samples += 1;
        // Count every appearance in the five following draws (not a binary window hit).
        followingFive.forEach(draw => draw.numbers.forEach(n => { counts[n] += 1; }));
      }
      const rates = {};
      NUMBERS.forEach(n => {
        rates[n] = (counts[n] + strength * P_SINGLE) / (5 * samples + strength);
      });
      return { trigger, samples, counts, rates };
    });
    const scores = {};
    NUMBERS.forEach(n => { scores[n] = average(perTrigger.map(x => x.rates[n])); });
    return { type: 'avg_count', priorStrength: strength, priorProbability: P_SINGLE, perTrigger, scores,
      sampleCount: perTrigger.reduce((s, x) => s + x.samples, 0) };
  }

  function rankScores(scores) {
    return NUMBERS.map(number => ({ number, score: scores[number] }))
      .sort((a, b) => b.score - a.score || a.number - b.number)
      .map((item, i) => ({ ...item, originalRank: i + 1 }));
  }

  function buildPrediction({ drawsNewestFirst, startIndex = 4, historyAnchorPeriod = '115000070' }) {
    if (!Array.isArray(drawsNewestFirst) || drawsNewestFirst.length < 55) {
      throw new Error('可用開獎資料不足，至少需要55期。');
    }
    const draws = drawsNewestFirst.map(validateDraw);
    if (startIndex !== 4) throw new Error('即時預測固定使用最新資料倒數第5期作為D0。');
    const d0 = draws[startIndex];
    const d1ToD4 = draws.slice(0, 4).slice().reverse(); // chronological D1 -> D4
    if (d1ToD4.length !== 4) throw new Error('尚未取得完整D1～D4，暫時不能預測D5。');
    const excluded = new Set(d1ToD4.flatMap(d => d.numbers));
    const historyBeforeD0 = draws.slice(startIndex + 1).filter(d => Number(d.period) >= Number(historyAnchorPeriod));
    if (historyBeforeD0.length < 50) throw new Error('錨點期別之後的D0以前歷史不足50期。');

    const models = [
      {
        id: 'v781_full_p10',
        name: 'v7.8.1 正式版',
        subtitle: '自研究錨點起全部可用歷史 · Prior10',
        method: 'any_hit',
        trainWindow: 'ALL',
        prior: 10,
        history: historyBeforeD0
      },
      {
        id: 'v781_t49_p10',
        name: 'v7.8.1 T49 對照版',
        subtitle: '最近49期訓練 · Prior10',
        method: 'any_hit',
        trainWindow: 49,
        prior: 10,
        history: historyBeforeD0.slice(0, 49)
      },
      {
        id: 'v79_avgcount_t49_p50',
        name: 'v7.9-shadow Average Count',
        subtitle: '最近49期訓練 · Average Count · Prior50',
        method: 'avg_count',
        trainWindow: 49,
        prior: 50,
        history: historyBeforeD0.slice(0, 49)
      }
    ];

    const computedModels = models.map(config => {
      const transition = config.method === 'avg_count'
        ? calculateAverageCount(config.history, d0.numbers, config.prior)
        : calculateAnyHit(config.history, d0.numbers, config.prior);
      const ranking = rankScores(transition.scores);
      const top15 = ranking.slice(0, TOP_K);
      const survivors = top15.filter(x => !excluded.has(x.number))
        .map((x, i) => ({ ...x, finalRank: i + 1 }));
      return {
        id: config.id, name: config.name, subtitle: config.subtitle,
        method: config.method, trainWindow: config.trainWindow, prior: config.prior,
        historyCount: config.history.length, triggerSamples: transition.perTrigger.map(x => ({ trigger: x.trigger, samples: x.samples })),
        ranking, top15, survivors, picks: survivors.slice(0, PICK_COUNT).map(x => x.number),
        scoreMap: transition.scores
      };
    });

    const targetPeriod = String(Number(d0.period) + 5);
    const overlap = {};
    computedModels.forEach(m => m.picks.forEach(n => { overlap[n] = (overlap[n] || 0) + 1; }));
    return {
      d0, d1ToD4, targetPeriod, latestDraw: draws[0], dataCount: draws.length,
      historyAnchorPeriod, historyStart: historyBeforeD0.length ? historyBeforeD0[historyBeforeD0.length - 1].period : null,
      historyEnd: historyBeforeD0.length ? historyBeforeD0[0].period : null,
      historyCount: historyBeforeD0.length,
      excludedNumbers: Array.from(excluded).sort((a, b) => a - b),
      models: computedModels,
      overlaps: Object.entries(overlap).map(([number, count]) => ({ number: Number(number), count })).sort((a,b) => b.count-a.count || a.number-b.number)
    };
  }

  const api = { NUMBERS, P5_ANY, P_SINGLE, calculateAnyHit, calculateAverageCount, rankScores, buildPrediction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.M539ThreeModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
