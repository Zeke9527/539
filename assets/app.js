(function () {
  'use strict';

  const API_URL = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result';
  const CONTENT_KEY = 'daily539Res';
  const CACHE_KEY = 'm539-draw-cache-v2';
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 15000;
  const MIN_SEQUENCE_WINDOWS = 20;
  const $ = id => document.getElementById(id);
  let draws = [];
  let isLoading = false;
  let hasUserEditedNumbers = false;
  let lastSequenceResult = null;
  let lastFourDrawFilterResult = null;

  const pad2 = value => String(value).padStart(2, '0');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const formatDate = value => {
    if (!value) return '—';
    const parts = value.split('-');
    return `${parts[0]}/${parts[1]}/${parts[2]}`;
  };

  function setStatus(message, type) {
    $('statusText').textContent = message;
    $('statusDot').className = `status-dot ${type || 'ok'}`;
  }

  function showNotice(message, type, targetId) {
    const notice = $(targetId || 'notice');
    notice.textContent = message || '';
    notice.className = message ? `notice ${type || 'info'}` : 'notice hidden';
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  async function fetchMonth(month) {
    const url = new URL(API_URL);
    url.searchParams.set('month', month);
    url.searchParams.set('pageSize', '500');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`台彩資料介面回應 HTTP ${response.status}`);
      const json = await response.json();
      const rows = json && json.content && json.content[CONTENT_KEY];
      if (!Array.isArray(rows)) throw new Error('資料回應格式改變，找不到 daily539Res。');
      return rows;
    } finally {
      clearTimeout(timeout);
    }
  }

  function normalizeDraw(row) {
    let raw = row && row.drawNumberAppear;
    if (typeof raw === 'string') raw = raw.split(/[,，、\s]+/).filter(Boolean);
    if (!Array.isArray(raw)) return null;
    const numbers = raw.map(Number);
    const date = String(row.lotteryDate || '').slice(0, 10);
    const period = String(row.period || '');
    if (numbers.length !== 5 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 39)) return null;
    if (new Set(numbers).size !== 5 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !period) return null;
    return { period, date, numbers: numbers.slice().sort((a, b) => a - b) };
  }

  function sortDraws(items) {
    return Array.from(items.values()).sort((a, b) =>
      b.date.localeCompare(a.date) || Number(b.period) - Number(a.period)
    );
  }

  function readCache() {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!cache || !Array.isArray(cache.draws) || !cache.savedAt) return null;
      return cache;
    } catch (_) { return null; }
  }

  function writeCache(items) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), draws: items })); }
    catch (_) { /* private browsing or storage quota: continue without persistent cache */ }
  }

  async function loadHistory(requestedCount, force) {
    const cached = readCache();
    if (!force && cached && Date.now() - cached.savedAt < CACHE_TTL_MS && cached.draws.length >= requestedCount) {
      return { draws: cached.draws.slice(0, requestedCount), source: 'cache', cachedAt: cached.savedAt };
    }

    const byPeriod = new Map();
    const cursor = new Date();
    cursor.setDate(1);
    let monthCount = 0;
    const maxMonths = 60;
    while (byPeriod.size < requestedCount && monthCount < maxMonths) {
      const month = monthKey(cursor);
      const rows = await fetchMonth(month);
      for (const row of rows) {
        const draw = normalizeDraw(row);
        if (draw) byPeriod.set(draw.period, draw);
      }
      cursor.setMonth(cursor.getMonth() - 1);
      monthCount += 1;
    }

    const sorted = sortDraws(byPeriod);
    if (sorted.length < Math.min(requestedCount, 65)) {
      throw new Error(`目前只取得 ${sorted.length} 期有效紀錄，至少需要 65 期才能執行六窗口分析。`);
    }
    writeCache(sorted);
    return { draws: sorted.slice(0, requestedCount), source: 'official-api', cachedAt: Date.now() };
  }

  function parseTriggerInput() {
    const raw = $('triggerInput').value.trim();
    const tokens = raw.split(/[\s,，、;；]+/).filter(Boolean);
    if (tokens.length !== 5) throw new Error('請輸入剛好 5 個號碼，例如：14、20、23、26、29。');
    if (tokens.some(token => !/^\d{1,2}$/.test(token))) throw new Error('請只輸入 01～39 的數字，使用逗號、空格或頓號分隔。');
    return window.M539Model.validateTriggers(tokens.map(Number));
  }

  function fillLatestNumbers() {
    if (!draws.length) return;
    $('triggerInput').value = draws[0].numbers.map(pad2).join('、');
    hasUserEditedNumbers = false;
    $('triggerIssue').textContent = `已帶入最新一期 ${draws[0].period}（${formatDate(draws[0].date)}）`;
  }

  function renderLatest() {
    const latest = draws[0];
    $('latestPeriod').textContent = latest ? latest.period : '—';
    $('latestDate').textContent = latest ? formatDate(latest.date) : '尚無資料';
    $('latestBalls').innerHTML = latest ? latest.numbers.map(n => `<span class="ball small">${pad2(n)}</span>`).join('') : '';
    $('drawCount').textContent = `${draws.length} 期`;
    $('rangeText').textContent = draws.length ? `${formatDate(draws[draws.length - 1].date)} ～ ${formatDate(draws[0].date)}` : '—';
    $('sourceUpdated').textContent = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    $('recentRows').innerHTML = draws.slice(0, 8).map(draw => `
      <tr><td>${escapeHtml(draw.period)}</td><td>${formatDate(draw.date)}</td>
      <td><div class="inline-balls">${draw.numbers.map(n => `<span class="mini-ball">${pad2(n)}</span>`).join('')}</div></td></tr>`).join('');
  }

  function getModeLabel(mode) {
    return mode === 'six' ? '六窗口模型' : mode === 'hybrid' ? '綜合模型（下一期轉移70%＋六窗口30%）' : '下一期轉移模型';
  }

  function renderPrediction(result) {
    $('resultTitle').textContent = `候選 ${result.count} 碼`;
    $('resultMode').textContent = getModeLabel(result.mode);
    $('resultBalls').innerHTML = result.picks.map((item, index) => `
      <div class="pick-ball-wrap"><span class="pick-ball">${pad2(item.number)}</span><span class="pick-rank">第 ${index + 1} 名</span></div>`).join('');

    const support = result.nextDraw.perTrigger.map(item => `${pad2(item.trigger)}：${item.samples} 次`).join('　／　');
    $('sampleSummary').textContent = `各觸發號碼的歷史有效下一期樣本：${support}。合計 ${result.nextDraw.sampleCount} 次條件樣本。`;
    $('baselineSummary').textContent = `任意指定號碼在單一期開出的理論基準為 ${(result.nextDraw.priorProbability * 100).toFixed(2)}%；以此作為平滑先驗，並非模型保證。`;

    const tableRows = result.candidates.slice(0, 12).map((item, index) => {
      const nextText = `${(item.nextDrawRate * 100).toFixed(2)}%`;
      const windowText = item.sixWindowScore.toFixed(3);
      const detail = item.perTrigger.map(part => `${pad2(part.trigger)}：${part.hits}/${part.samples || 0}`).join('；');
      const scoreText = result.mode === 'six' ? item.sixWindowZ.toFixed(3) : result.mode === 'hybrid' ? item.combinedScore.toFixed(3) : nextText;
      return `<tr${index < result.count ? ' class="selected-row"' : ''}>
        <td>${index + 1}</td><td><strong>${pad2(item.number)}</strong></td><td>${scoreText}</td>
        <td>${nextText}</td><td>${windowText}</td><td class="detail-cell" title="${escapeHtml(detail)}">${escapeHtml(detail)}</td></tr>`;
    }).join('');
    $('rankingTable').innerHTML = `<table><thead><tr><th>排名</th><th>號碼</th><th>模型分數</th><th>下一期平滑估計</th><th>六窗口分數</th><th>觸發號碼命中／樣本</th></tr></thead><tbody>${tableRows}</tbody></table>`;

    $('triggerSupport').innerHTML = result.nextDraw.perTrigger.map(item => `
      <div class="support-card"><div class="support-number">${pad2(item.trigger)}</div>
      <div><strong>${item.samples} 次有效樣本</strong><small>歷史開出 ${pad2(item.trigger)} 後，觀察緊接著的下一期</small></div></div>`).join('');
    $('resultPanel').classList.remove('hidden');
  }

  function runAnalysis() {
    if (!draws.length) {
      showNotice('歷史資料尚未載入完成，請稍候或按更新資料。', 'warning');
      return;
    }
    try {
      const triggers = parseTriggerInput();
      const numberCount = Number($('numberCount').value);
      const mode = $('modelMode').value;
      const result = window.M539Model.analyze(draws, triggers, numberCount, mode, {
        transition: { lookback: draws.length, priorStrength: 10 },
        sixWindow: { windows: [6, 12, 18, 24, 30, 60], shrinkage: 12 }
      });
      renderPrediction(result);
      showNotice('', 'info');
    } catch (error) {
      $('resultPanel').classList.add('hidden');
      showNotice(error.message || '分析失敗，請檢查輸入內容。', 'error');
    }
  }

  function sequenceTrainingWindows(startIndex) {
    return Math.max(0, draws.length - startIndex - 6);
  }

  function populateSequencePeriods() {
    const select = $('sequencePeriod');
    const previous = select.value;
    const eligible = [];
    for (let index = 4; index < draws.length; index += 1) {
      const windows = sequenceTrainingWindows(index);
      if (windows >= MIN_SEQUENCE_WINDOWS) eligible.push({ draw: draws[index], index, windows });
    }
    if (!eligible.length) {
      select.innerHTML = '<option value="">沒有符合條件的起始期</option>';
      select.disabled = true;
      $('fifthDayGenerateBtn').disabled = true;
    $('fourDrawFilterBtn').disabled = true;
      $('sequencePeriodHelp').textContent = `至少需要 ${MIN_SEQUENCE_WINDOWS} 組歷史訓練序列；請載入更多期數。`;
      return;
    }
    select.innerHTML = eligible.map(item => `<option value="${escapeHtml(item.draw.period)}">${escapeHtml(item.draw.period)}｜${formatDate(item.draw.date)}（歷史訓練 ${item.windows} 組）</option>`).join('');
    select.disabled = false;
    $('fifthDayGenerateBtn').disabled = false;
    $('fourDrawFilterBtn').disabled = false;
    if (eligible.some(item => String(item.draw.period) === String(previous))) select.value = previous;
    else select.value = eligible[0].draw.period;
    $('sequencePeriodHelp').textContent = `可選 ${eligible.length} 個起始期；每個起始期均已有後續4期開獎，且至少有 ${MIN_SEQUENCE_WINDOWS} 組更早歷史訓練序列。`;
    renderSequenceContext();
  }

  function renderSequenceContext() {
    if (!draws.length || !$('sequencePeriod').value) return;
    try {
      const context = window.M539Model.getFiveDayContext(draws, $('sequencePeriod').value);
      const chronological = context.contextChronological;
      const rows = chronological.map((draw, index) => `
        <tr><td>${index === 0 ? '<span class="sequence-tag start-tag">起始期</span>' : `<span class="sequence-tag">第${index}期</span>`}</td>
        <td>${escapeHtml(draw.period)}</td><td>${formatDate(draw.date)}</td>
        <td><div class="inline-balls">${draw.numbers.map(n => `<span class="mini-ball">${pad2(n)}</span>`).join('')}</div></td></tr>`).join('');
      const targetLine = context.targetDraw
        ? `<div class="sequence-target known"><strong>第五期實際結果（歷史驗證）：</strong> ${escapeHtml(context.targetDraw.period)}｜${formatDate(context.targetDraw.date)}　${context.targetDraw.numbers.map(pad2).join('、')}</div>`
        : '<div class="sequence-target pending"><strong>第五期：</strong> 後續四期已完整，下一期尚未開出；模型將預測這一期。</div>';
      $('sequenceContext').innerHTML = `
        <div class="table-scroll"><table class="sequence-table"><thead><tr><th>位置</th><th>期別</th><th>日期</th><th>實際開獎號碼</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${targetLine}`;
      $('sequenceResult').classList.add('hidden');
      $('fourDrawFilterResult').classList.add('hidden');
      lastSequenceResult = null;
      lastFourDrawFilterResult = null;
      showNotice('', 'info', 'sequenceNotice');
      showNotice('', 'info', 'fourDrawFilterNotice');
    } catch (error) {
      $('sequenceContext').innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
      $('sequenceResult').classList.add('hidden');
      $('fourDrawFilterResult').classList.add('hidden');
      lastFourDrawFilterResult = null;
    }
  }

  function renderSequencePrediction(result) {
    const count = Number($('numberCount').value) || 3;
    const picks = result.candidates.slice(0, count);
    $('sequenceResultTitle').textContent = `第五期候選 ${count} 碼`;
    const contextRange = result.contextChronological.map(draw => draw.period).join(' → ');
    $('sequenceResultSubtitle').textContent = `起始期 ${result.startPeriod}；輸入序列：${contextRange}。訓練資料只使用起始期以前的歷史。`;
    $('sequenceResultBalls').innerHTML = picks.map((item, index) => `
      <div class="pick-ball-wrap"><span class="pick-ball">${pad2(item.number)}</span><span class="pick-rank">第 ${index + 1} 名</span></div>`).join('');
    $('sequenceSampleSummary').textContent = `${result.trainingWindows} 組歷史五期序列；目前輸入序列有 ${result.contextNumberCount} 個不同號碼作為條件特徵。歷史序列會重疊，非獨立樣本。`;
    $('sequenceBaselineSummary').textContent = `任意單一號碼在單一期開出的理論基準為 ${(result.priorProbability * 100).toFixed(2)}%；模型分數僅是平滑條件估計。`;

    const actual = result.targetDraw;
    const actualSet = actual ? new Set(actual.numbers) : null;
    const hits = actual ? picks.filter(item => actualSet.has(item.number)).map(item => item.number) : [];
    const tableRows = result.candidates.slice(0, 12).map((item, index) => {
      const sources = item.contextSupport
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 8)
        .map(part => `${pad2(part.trigger)} ${part.hits}/${part.samples}`)
        .join('；');
      const isHit = actualSet && actualSet.has(item.number);
      return `<tr${index < count ? ' class="selected-row"' : ''}>
        <td>${index + 1}</td><td><strong>${pad2(item.number)}</strong></td>
        <td>${(item.score * 100).toFixed(2)}%</td>
        <td class="detail-cell" title="${escapeHtml(sources)}">${escapeHtml(sources)}</td>
        ${actual ? `<td>${isHit ? '<span class="hit-mark">命中</span>' : '—'}</td>` : ''}
      </tr>`;
    }).join('');
    const actualHeader = actual ? '<th>實際結果</th>' : '';
    $('sequenceRankingTable').innerHTML = `<table><thead><tr><th>排名</th><th>號碼</th><th>模型關聯分數</th><th>主要條件樣本（命中／樣本）</th>${actualHeader}</tr></thead><tbody>${tableRows}</tbody></table>`;

    if (actual) {
      showNotice(`這是歷史回放驗證：第五期實際開出 ${actual.numbers.map(pad2).join('、')}；你選擇的前 ${count} 碼命中 ${hits.length} 碼${hits.length ? `（${hits.map(pad2).join('、')}）` : ''}。預測訓練資料已排除起始期當日及其後資料。`, 'info', 'sequenceNotice');
    } else {
      showNotice('這是目前資料中最新可用的第五期預測：起始期後的四期已開出，第五期尚未開出。等第五期開獎後，可更新資料並選擇相同起始期進行驗證。', 'info', 'sequenceNotice');
    }
    $('sequenceResult').classList.remove('hidden');
    lastSequenceResult = result;
  }

  function runFifthDayAnalysis() {
    if (!draws.length || !$('sequencePeriod').value) {
      showNotice('請先載入歷史資料並選擇起始期別。', 'warning', 'sequenceNotice');
      return;
    }
    try {
      const result = window.M539Model.calculateFifthDaySequence(draws, $('sequencePeriod').value, {
        priorStrength: 12,
        recencyDecay: 0.72,
        minimumTrainingWindows: MIN_SEQUENCE_WINDOWS
      });
      renderSequencePrediction(result);
    } catch (error) {
      $('sequenceResult').classList.add('hidden');
      showNotice(error.message || '第五期序列分析失敗。', 'error', 'sequenceNotice');
    }
  }

  function parseOptionalCandidateRanking() {
    const raw = $('filterCustomRanking').value.trim();
    if (!raw) return null;
    const tokens = raw.split(/[\s,，、;；]+/).filter(Boolean);
    if (!tokens.length || tokens.length > 39 || tokens.some(token => !/^\d{1,2}$/.test(token))) {
      throw new Error('自訂候選排名請輸入1～39個01～39號碼，以逗號、空格或頓號分隔。');
    }
    const numbers = tokens.map(Number);
    if (numbers.some(number => number < 1 || number > 39) || new Set(numbers).size !== numbers.length) {
      throw new Error('自訂候選排名必須是01～39且不可重複。');
    }
    return numbers;
  }

  function renderFourDrawFilter(result) {
    const count = Number($('numberCount').value) || 3;
    const picks = result.survivors.slice(0, count);
    $('fourDrawFilterBalls').innerHTML = picks.length
      ? picks.map((item, index) => `<div class="pick-ball-wrap"><span class="pick-ball">${pad2(item.number)}</span><span class="pick-rank">保留第 ${item.finalRank} 名</span></div>`).join('')
      : '<p class="empty-state">原始候選池中的號碼已全部被排除，請提高原始候選池名次範圍。</p>';

    const metrics = [
      ['原始候選池', `${result.candidatePool.length} 碼`],
      ['後四期排除', `${result.eliminatedCandidates.length} 碼`],
      ['剩餘候選', `${result.survivors.length} 碼`],
      ['歷史訓練', `${result.trainingDrawCount} 期`]
    ];
    if (result.targetDraw) {
      metrics.push(['原始池命中', `${result.originalHits.length} 碼`]);
      metrics.push(['排除後命中', `${result.survivorHits.length} 碼`]);
    }
    $('fourDrawFilterSummary').innerHTML = metrics.map(([label, value]) => `
      <div class="filter-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');

    $('fourDrawExcluded').innerHTML = result.eliminatedCandidates.length
      ? result.eliminatedCandidates.map(item => {
          const periods = item.appearedIn.map(draw => draw.period).join('、');
          return `<span class="filter-number removed" title="出現於 ${escapeHtml(periods)}">${pad2(item.number)} <small>${escapeHtml(periods)}</small></span>`;
        }).join('')
      : '<span class="empty-state">沒有候選號碼在後四期出現。</span>';
    $('fourDrawSurvivors').innerHTML = result.survivors.length
      ? result.survivors.map(item => `<span class="filter-number kept">${pad2(item.number)} <small>第${item.finalRank}名</small></span>`).join('')
      : '<span class="empty-state">沒有剩餘候選號碼。</span>';

    const actualSet = result.targetDraw ? new Set(result.targetDraw.numbers) : null;
    const rows = result.candidatePool.map(item => {
      const eliminated = result.eliminatedCandidates.find(candidate => candidate.number === item.number);
      const survivor = result.survivors.find(candidate => candidate.number === item.number);
      const selected = survivor && survivor.finalRank <= count;
      const appearedIn = eliminated ? eliminated.appearedIn.map(draw => draw.period).join('、') : '';
      const status = eliminated
        ? `<span class="filter-status removed-status">已排除（${escapeHtml(appearedIn)}）</span>`
        : `<span class="filter-status kept-status">保留第 ${survivor.finalRank} 名${selected ? '｜列入本次選號' : ''}</span>`;
      const actual = actualSet ? (actualSet.has(item.number) ? '<span class="hit-mark">命中</span>' : '—') : '尚未開獎';
      return `<tr${selected ? ' class="selected-row"' : ''}>
        <td>${item.originalRank}</td><td><strong>${pad2(item.number)}</strong></td>
        <td>${(item.score * 100).toFixed(2)}%</td><td>${status}</td><td>${actual}</td></tr>`;
    }).join('');
    $('fourDrawFilterTable').innerHTML = `<table><thead><tr><th>原排名</th><th>號碼</th><th>後五期平滑分數</th><th>排除結果</th><th>第五期對獎</th></tr></thead><tbody>${rows}</tbody></table>`;

    const contextPeriods = result.observedFollowingFour.map(draw => draw.period).join(' → ');
    if (result.targetDraw) {
      const picksHits = picks.filter(item => actualSet.has(item.number)).map(item => pad2(item.number));
      showNotice(
        `歷史回放（${result.candidateSource === 'custom' ? '自訂排名' : '模型排名'}）：${result.startPeriod} 期開出後，觀察 ${contextPeriods}；第五期 ${result.targetDraw.period} 實際開出 ${result.targetDraw.numbers.map(pad2).join('、')}。原始候選池命中 ${result.originalHits.length} 碼；排除後保留 ${result.survivors.length} 碼，其中本次選出的 ${picks.length} 碼命中 ${picksHits.length} 碼${picksHits.length ? `（${picksHits.join('、')}）` : ''}。`,
        'info', 'fourDrawFilterNotice'
      );
    } else {
      showNotice(
        `預測模式（${result.candidateSource === 'custom' ? '自訂排名' : '模型排名'}）：起始期 ${result.startPeriod} 後四期（${contextPeriods}）已開出；已排除這四期曾出現的候選號碼，等待第五期開獎驗證。`,
        'info', 'fourDrawFilterNotice'
      );
    }
    $('fourDrawFilterResult').classList.remove('hidden');
    lastFourDrawFilterResult = result;
  }

  function runFourDrawFilterAnalysis() {
    if (!draws.length || !$('sequencePeriod').value) {
      showNotice('請先載入歷史資料並選擇起始期別。', 'warning', 'fourDrawFilterNotice');
      return;
    }
    try {
      const result = window.M539Model.calculateFourDrawElimination(draws, $('sequencePeriod').value, {
        candidatePoolSize: Number($('filterPoolSize').value) || 12,
        candidateNumbers: parseOptionalCandidateRanking(),
        priorStrength: 10
      });
      renderFourDrawFilter(result);
    } catch (error) {
      $('fourDrawFilterResult').classList.add('hidden');
      lastFourDrawFilterResult = null;
      showNotice(error.message || '後四期排除分析失敗。', 'error', 'fourDrawFilterNotice');
    }
  }

  async function refreshData(force) {
    if (isLoading) return;
    isLoading = true;
    $('refreshBtn').disabled = true;
    $('generateBtn').disabled = true;
    $('fifthDayGenerateBtn').disabled = true;
    $('fourDrawFilterBtn').disabled = true;
    $('refreshBtn').textContent = '更新中…';
    setStatus('正在抓取台彩歷史資料', 'loading');
    if (!force) showNotice('', 'info');
    try {
      const requestedCount = Number($('historyCount').value) || 200;
      const result = await loadHistory(requestedCount, Boolean(force));
      draws = result.draws;
      renderLatest();
      if (!hasUserEditedNumbers || !$('triggerInput').value.trim()) fillLatestNumbers();
      populateSequencePeriods();
      setStatus(result.source === 'cache' ? '使用快取資料' : '歷史資料已更新', 'ok');
      runAnalysis();
      if (result.source === 'cache') {
        showNotice('目前使用瀏覽器快取的歷史資料。按「更新資料」可強制重新向台彩資料介面抓取。', 'info');
      } else {
        showNotice(`已載入 ${draws.length} 期今彩539紀錄。資料由台灣彩券網站資料介面取得；請以官方公告為準。`, 'info');
      }
    } catch (error) {
      console.error(error);
      const cached = readCache();
      if (cached && Array.isArray(cached.draws) && cached.draws.length >= 65) {
        draws = cached.draws.slice(0, Number($('historyCount').value) || 200);
        renderLatest();
        if (!hasUserEditedNumbers || !$('triggerInput').value.trim()) fillLatestNumbers();
        populateSequencePeriods();
        setStatus('抓取失敗，改用快取', 'error');
        runAnalysis();
        showNotice(`無法取得最新資料：${error.message}。目前顯示快取資料（快取時間：${new Date(cached.savedAt).toLocaleString('zh-TW')}），請不要將它視為最新開獎。`, 'warning');
      } else {
        setStatus('資料載入失敗', 'error');
        showNotice(`無法取得台彩歷史資料：${error.message}。請稍後重試，或檢查瀏覽器是否封鎖跨網域請求。`, 'error');
      }
    } finally {
      isLoading = false;
      $('refreshBtn').disabled = false;
      $('generateBtn').disabled = false;
      $('refreshBtn').textContent = '↻ 更新資料';
      $('fifthDayGenerateBtn').disabled = !$('sequencePeriod').value;
      $('fourDrawFilterBtn').disabled = !$('sequencePeriod').value;
    }
  }

  $('generateBtn').addEventListener('click', runAnalysis);
  $('refreshBtn').addEventListener('click', () => refreshData(true));
  $('useLatestBtn').addEventListener('click', fillLatestNumbers);
  $('historyCount').addEventListener('change', () => refreshData(false));
  $('numberCount').addEventListener('change', () => {
    if (draws.length) runAnalysis();
    if (lastSequenceResult) renderSequencePrediction(lastSequenceResult);
    if (lastFourDrawFilterResult) renderFourDrawFilter(lastFourDrawFilterResult);
  });
  $('modelMode').addEventListener('change', () => { if (draws.length) runAnalysis(); });
  $('sequencePeriod').addEventListener('change', renderSequenceContext);
  $('fifthDayGenerateBtn').addEventListener('click', runFifthDayAnalysis);
  $('fourDrawFilterBtn').addEventListener('click', runFourDrawFilterAnalysis);
  $('filterPoolSize').addEventListener('change', runFourDrawFilterAnalysis);
  $('filterCustomRanking').addEventListener('keydown', event => { if (event.key === 'Enter') runFourDrawFilterAnalysis(); });
  $('triggerInput').addEventListener('input', () => {
    hasUserEditedNumbers = true;
    $('triggerIssue').textContent = '自訂觸發號碼；模型會使用目前載入的歷史資料統計下一期轉移關係。';
  });
  $('triggerInput').addEventListener('keydown', event => { if (event.key === 'Enter') runAnalysis(); });

  refreshData(false);
})();
