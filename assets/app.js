(function () {
  'use strict';

  const API_URL = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result';
  const CONTENT_KEY = 'daily539Res';
  const APP_VERSION = 'v7.8.1';
  const CACHE_KEY = 'm539-final-v7-8-1-draw-cache';
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 10000;
  const HISTORY_COUNT = 200;
  const PICKER_COUNT = 15;
  const MODES = {
    mode35: { id: 'mode35', label: '模式一', historyWindow: 35, exclusionCount: 3, pickCount: 2, description: '訓練35期・排除3期・選2碼' },
    mode49: { id: 'mode49', label: '模式二', historyWindow: 49, exclusionCount: 4, pickCount: 2, description: '訓練49期・排除4期・選2碼' }
  };
  let selectedModeId = 'mode35';
  const $ = id => document.getElementById(id);
  if (!window.M539FinalModel) throw new Error('model.js 未載入');
  window.M539AppBooted = true;

  let draws = [];
  let selectedPeriod = null;
  let lastResult = null;
  let isLoading = false;
  let dataSourceWarning = '';

  function addDataSourceWarning(message) {
    return dataSourceWarning ? `${dataSourceWarning} ${message}` : message;
  }

  if ($('appVersion')) $('appVersion').textContent = APP_VERSION;

  const pad2 = value => String(value).padStart(2, '0');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function formatDate(date) {
    const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[1]}/${match[2]}/${match[3]}` : String(date || '—');
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function setStatus(message, type) {
    $('statusText').textContent = `${APP_VERSION} · ${message}`;
    $('statusDot').className = `status-dot ${type || 'ok'}`;
  }

  function showNotice(message, type, elementId) {
    const node = $(elementId || 'pickerNotice');
    node.textContent = message || '';
    node.className = message ? `notice ${type || 'info'}` : 'notice hidden';
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
    if (numbers.length !== 5 || numbers.some(number => !Number.isInteger(number) || number < 1 || number > 39)) return null;
    if (new Set(numbers).size !== 5 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !period) return null;
    return { period, date, numbers: numbers.slice().sort((a, b) => a - b) };
  }

  function sortDraws(items) {
    return Array.from(items.values()).sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
      return Number(b.period) - Number(a.period);
    });
  }

  function getBundledHistory() {
    const bundled = window.M539BundledHistory;
    if (!Array.isArray(bundled)) return [];
    return bundled
      .filter(draw => draw && /^\d+$/.test(String(draw.period)) && Array.isArray(draw.numbers) && draw.numbers.length === 5)
      .map(draw => ({
        period: String(draw.period),
        date: String(draw.date || ''),
        numbers: draw.numbers.map(Number).sort((a, b) => a - b)
      }))
      .filter(draw => draw.numbers.every(number => Number.isInteger(number) && number >= 1 && number <= 39) && new Set(draw.numbers).size === 5)
      .sort((a, b) => Number(b.period) - Number(a.period))
      .slice(0, HISTORY_COUNT);
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
    catch (_) { /* Storage may be unavailable; in-memory data still works. */ }
  }

  async function fetchRecentHistoryMonths(monthsBack) {
    const cursor = new Date();
    cursor.setDate(1);
    const months = [];
    for (let i = 0; i < monthsBack; i += 1) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
      months.push(monthKey(date));
    }

    const results = await Promise.allSettled(months.map(month => fetchMonth(month)));
    const byPeriod = new Map();
    const errors = [];
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      if (result.status === 'rejected') {
        errors.push(`${months[i]}：${result.reason && result.reason.message ? result.reason.message : '讀取失敗'}`);
        continue;
      }
      for (const row of result.value) {
        const draw = normalizeDraw(row);
        if (draw) byPeriod.set(draw.period, draw);
      }
    }
    return { draws: sortDraws(byPeriod), errors };
  }

  async function loadHistory(force) {
    const cached = readCache();
    if (!force && cached && Date.now() - cached.savedAt < CACHE_TTL_MS && cached.draws.length >= HISTORY_COUNT) {
      return { draws: cached.draws.slice(0, HISTORY_COUNT), source: 'cache', cachedAt: cached.savedAt };
    }

    // Recent 12 months should comfortably cover 200 Daily 539 draws. If the
    // endpoint returns fewer records, expand once to 18 months. Requests are
    // parallel so the picker no longer waits through a long month-by-month loop.
    let fetched = await fetchRecentHistoryMonths(12);
    if (fetched.draws.length > 0 && fetched.draws.length < HISTORY_COUNT) {
      const expanded = await fetchRecentHistoryMonths(18);
      if (expanded.draws.length > fetched.draws.length) fetched = expanded;
    }

    if (fetched.draws.length < HISTORY_COUNT) {
      const detail = fetched.errors.length ? `；部分月份讀取失敗：${fetched.errors.slice(0, 3).join('；')}` : '';
      throw new Error(`即時資料目前取得 ${fetched.draws.length}/${HISTORY_COUNT} 期有效紀錄${detail}。已保留內建備援資料供查詢，請稍後再更新。`);
    }

    const latest = fetched.draws.slice(0, HISTORY_COUNT);
    writeCache(latest);
    return { draws: latest, source: 'official-api', cachedAt: Date.now() };
  }

  function drawBallMarkup(number, extraClass) {
    return `<span class="mini-ball ${extraClass || ''}">${pad2(number)}</span>`;
  }

  function renderLatest() {
    const latest = draws[0];
    $('latestPeriod').textContent = latest ? latest.period : '—';
    $('latestDate').textContent = latest ? formatDate(latest.date) : '尚無資料';
    $('latestBalls').innerHTML = latest ? latest.numbers.map(number => `<span class="ball small">${pad2(number)}</span>`).join('') : '';
    $('drawCount').textContent = `${draws.length} 期`;
    $('rangeText').textContent = draws.length ? `${formatDate(draws[draws.length - 1].date)} ～ ${formatDate(draws[0].date)}` : '—';
  }

  function getMode() { return MODES[selectedModeId]; }

  // Resolve a draw's position in the newest-first history array.
  function getStartIndex(period) {
    return draws.findIndex(draw => String(draw.period) === String(period));
  }

  function renderModeSettings() {
    const mode = getMode();
    document.querySelectorAll('.mode-option').forEach(button => {
      const active = button.dataset.mode === selectedModeId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('historySettingLabel').textContent = `訓練${mode.historyWindow}期`;
    $('excludeSettingLabel').textContent = `排除${mode.exclusionCount}期・選${mode.pickCount}碼`;
  }

  function isEligibleIndex(index) {
    const mode = getMode();
    return index >= mode.exclusionCount && draws.length - index - 1 >= mode.historyWindow;
  }

  function getNextDraws(index) {
    const count = getMode().exclusionCount;
    if (index <= 0) return [];
    return draws.slice(Math.max(0, index - count), index).reverse();
  }

  function renderDrawOptions() {
    const recent = draws.slice(0, PICKER_COUNT);
    $('drawOptions').innerHTML = recent.map((draw, localIndex) => {
      const index = getStartIndex(draw.period);
      const mode = getMode();
      const laterCount = Math.min(index, mode.exclusionCount);
      const eligible = isEligibleIndex(index);
      const selected = String(draw.period) === String(selectedPeriod);
      let stateText = eligible ? (index === mode.exclusionCount ? `可預測｜後${mode.exclusionCount}期已齊` : `可回放｜第${mode.exclusionCount + 1}期已開`) : `後續資料 ${laterCount}/${mode.exclusionCount} 期`;
      if (selected) stateText = '目前選定';
      return `<button class="draw-option ${selected ? 'selected' : ''}" type="button" data-period="${escapeHtml(draw.period)}" aria-pressed="${selected}">
        <div class="draw-option-top"><span class="draw-period">${escapeHtml(draw.period)}</span><span class="draw-index">#${localIndex + 1}</span></div>
        <span class="draw-date">${formatDate(draw.date)}</span>
        <div class="draw-balls">${draw.numbers.map(number => drawBallMarkup(number)).join('')}</div>
        <span class="draw-state ${eligible ? '' : 'pending'} ${selected ? 'selected-tag' : ''}">${stateText}</span>
      </button>`;
    }).join('');

    $('drawOptions').querySelectorAll('.draw-option').forEach(button => {
      button.addEventListener('click', () => selectPeriod(button.dataset.period));
    });
  }

  function renderSelectionContext() {
    const index = getStartIndex(selectedPeriod);
    if (index < 0) {
      $('selectionContext').innerHTML = '<p class="muted">請先選擇起始期。</p>';
      $('selectedPeriodLabel').textContent = '尚未選擇';
      $('selectedNumbersLabel').textContent = '—';
      $('generateBtn').disabled = true;
      return;
    }

    const start = draws[index];
    const later = getNextDraws(index);
    $('selectedPeriodLabel').textContent = `${start.period}｜${formatDate(start.date)}`;
    $('selectedNumbersLabel').textContent = `起始號碼：${start.numbers.map(pad2).join('、')}`;

    const mode = getMode();
    const contextCards = [`<div class="context-draw start"><span class="context-label">起始期 D0</span><div class="context-period">${escapeHtml(start.period)}</div><div class="context-balls">${start.numbers.map(number => drawBallMarkup(number)).join('')}</div></div>`];
    for (let step = 0; step < mode.exclusionCount; step += 1) {
      const draw = later[step];
      contextCards.push(draw
        ? `<div class="context-draw"><span class="context-label">排除期 D${step + 1}</span><div class="context-period">${escapeHtml(draw.period)}</div><div class="context-balls">${draw.numbers.map(number => drawBallMarkup(number)).join('')}</div></div>`
        : `<div class="context-placeholder"><span>排除期 D${step + 1}<br>等待開獎</span></div>`);
    }
    $('selectionContext').innerHTML = `<div class="selection-context-grid" style="grid-template-columns:repeat(${mode.exclusionCount + 1},minmax(0,1fr))">${contextCards.join('')}</div>`;

    const enoughHistory = draws.slice(index + 1).length >= mode.historyWindow;
    const eligible = later.length === mode.exclusionCount && enoughHistory;
    $('generateBtn').disabled = !eligible;
    if (!eligible) {
      const missing = Math.max(0, mode.exclusionCount - later.length);
      const warningText = missing > 0
        ? `你選擇的是 ${start.period} 期。此期之後目前只有 ${later.length} 期已開獎，還需要 ${missing} 期；等後續${mode.exclusionCount}期完整後，才能執行「排除後${mode.exclusionCount}期」並產生候選。`
        : `起始期以前的歷史資料不足；目前模式固定使用${mode.historyWindow}期訓練，至少需要${mode.historyWindow}期歷史資料。`;
      showNotice(addDataSourceWarning(warningText), 'warning', 'pickerNotice');
    } else if (index === mode.exclusionCount) {
      showNotice(addDataSourceWarning(`已選定 ${start.period} 期。後續${mode.exclusionCount}期已全部開出，目標期尚未開出；現在可以進行預測。`), dataSourceWarning ? 'warning' : 'info', 'pickerNotice');
    } else {
      const target = draws[index - mode.exclusionCount - 1];
      showNotice(addDataSourceWarning(`已選定 ${start.period} 期。這是歷史回放：排除後第${mode.exclusionCount + 1}期 ${target.period} 已有實際開獎資料，產生候選後可同時查看命中結果。`), dataSourceWarning ? 'warning' : 'info', 'pickerNotice');
    }
  }

  function selectPeriod(period) {
    selectedPeriod = String(period);
    lastResult = null;
    $('resultPanel').classList.add('hidden');
    renderDrawOptions();
    renderSelectionContext();
  }

  function renderObservedDraws(result) {
    const pool = new Set(result.candidatePool.map(item => item.number));
    $('observedDraws').style.gridTemplateColumns = `repeat(${result.exclusionCount},minmax(0,1fr))`;
    $('observedDraws').innerHTML = result.observedFollowing.map((draw, index) => {
      const hits = draw.numbers.filter(number => pool.has(number));
      return `<div class="observed-card">
        <strong>D${index + 1} · ${escapeHtml(draw.period)}</strong>
        <small>${formatDate(draw.date)} · 排除候選 ${hits.length} 碼</small>
        <div class="observed-balls">${draw.numbers.map(number => drawBallMarkup(number, pool.has(number) ? 'removed' : '')).join('')}</div>
      </div>`;
    }).join('');
  }

  function renderResult() {
    if (!lastResult) return;
    const result = lastResult;
    const count = result.pickCount;
    const picks = result.survivors.slice(0, count);
    const actual = result.targetDraw;

    $('resultTitle').textContent = `排除後候選 ${picks.length} 碼`;
    $('resultSubtitle').textContent = `起始期 ${result.startPeriod}｜訓練${result.historyWindow}期｜原始排名前15碼｜排除D1～D${result.exclusionCount}曾開出的號碼｜依原始排名順序選出2碼。`;
    $('resultMode').textContent = `TRAIN ${result.historyWindow} · EXCLUDE ${result.exclusionCount} · PICK 2`;
    $('observedHeading').textContent = `後續${result.exclusionCount}期開獎與排除紀錄`;
    $('observedDescription').textContent = `只要號碼在D1～D${result.exclusionCount}任一期出現，就從原始前15碼移除；D0不參與排除。`;
    $('resultBalls').innerHTML = picks.length
      ? picks.map((item, index) => `<div class="pick-ball-wrap"><span class="pick-ball">${pad2(item.number)}</span><span class="pick-rank">保留排名 ${item.finalRank}</span></div>`).join('')
      : '<p class="muted">前15名都曾在指定排除期出現，沒有剩餘候選號碼。</p>'; 

    const trainingRange = result.trainingRange
      ? `${result.trainingRange.oldest.period} ～ ${result.trainingRange.newest.period}`
      : '—';
    const metrics = [
      ['歷史訓練期數', `${result.historyDrawCount} 期（選擇 ${result.historyWindow} 期）`],
      ['訓練期別範圍', trainingRange],
      ['原始候選', `${result.candidatePool.length} 碼`],
      ['被排除', `${result.eliminatedCandidates.length} 碼`],
      ['剩餘候選', `${result.survivors.length} 碼`],
      ['本次輸出', `${picks.length}/${count} 碼`]
    ];
    if (actual) {
      metrics.push(['目標期命中', `${result.survivorHits.length} 碼`]);
      metrics.push(['目標期', result.targetDraw.period]);
    }
    $('resultMetrics').innerHTML = metrics.map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join('');

    if (actual) {
      const hits = picks.filter(item => actual.numbers.includes(item.number)).map(item => pad2(item.number));
      showNotice(`歷史回放：排除後第${result.exclusionCount + 1}期 ${actual.period} 實際開出 ${actual.numbers.map(pad2).join('、')}；原始前15碼命中 ${result.originalHits.length} 碼，排除後完整候選命中 ${result.survivorHits.length} 碼；本次選出的 ${picks.length} 碼命中 ${hits.length} 碼${hits.length ? `（${hits.join('、')}）` : ''}。`, 'info', 'resultNotice');
    } else {
      showNotice(`目前是預測模式：排除後第${result.exclusionCount + 1}期尚未開出。資料更新後選回相同起始期，即可進行實際命中驗證。`, 'warning', 'resultNotice');
    }

    renderObservedDraws(result);
    $('survivorCount').textContent = `${result.survivors.length} 碼保留`;
    $('survivorList').innerHTML = result.survivors.length
      ? result.survivors.map((item, index) => `<span class="survivor-pill ${index < count ? 'selected' : ''}">${pad2(item.number)} <small>原第${item.originalRank}名</small></span>`).join('')
      : '<p class="muted">沒有剩餘候選。</p>';

    const eliminatedByNumber = new Map(result.eliminatedCandidates.map(item => [item.number, item]));
    const survivorsByNumber = new Map(result.survivors.map(item => [item.number, item]));
    const actualSet = actual ? new Set(actual.numbers) : null;
    const rows = result.candidatePool.map(item => {
      const eliminated = eliminatedByNumber.get(item.number);
      const survivor = survivorsByNumber.get(item.number);
      const selected = survivor && survivor.finalRank <= count;
      const status = eliminated
        ? `<span class="status-removed">已排除 · ${eliminated.appearedIn.map(draw => escapeHtml(draw.period)).join('、')}</span>`
        : `<span class="status-kept">保留第${survivor.finalRank}名${selected ? ' · 本次選取' : ''}</span>`;
      const hit = actualSet ? (actualSet.has(item.number) ? '<strong>命中</strong>' : '—') : '待開獎';
      return `<tr${selected ? ' class="selected-row"' : ''}><td>${item.originalRank}</td><td><strong>${pad2(item.number)}</strong></td><td>${(item.score * 100).toFixed(2)}%</td><td>${status}</td><td>${hit}</td></tr>`;
    }).join('');
    $('rankingTable').innerHTML = `<table><thead><tr><th>原排名</th><th>號碼</th><th>後五期平滑分數</th><th>排除結果</th><th>目標期對獎</th></tr></thead><tbody>${rows}</tbody></table>`;

    $('sampleCards').innerHTML = result.transition.perTrigger.map(item => `
      <div class="sample-card"><span class="sample-number">${pad2(item.trigger)}</span><div><b>${item.samples} 次有效樣本</b><small>歷史出現後的五期觀察</small></div></div>`).join('');
    $('resultPanel').classList.remove('hidden');
  }

  function runAnalysis() {
    if (!selectedPeriod) return;
    try {
      const mode = getMode();
      lastResult = window.M539FinalModel.calculateFinalPrediction(draws, selectedPeriod, {
        candidatePoolSize: 15,
        priorStrength: 10,
        historyWindow: mode.historyWindow,
        exclusionCount: mode.exclusionCount,
        pickCount: mode.pickCount
      });
      renderResult();
      $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showNotice(error.message || '分析失敗，請重新選擇期別或更新資料。', 'error', 'pickerNotice');
    }
  }

  async function refreshData(force) {
    if (isLoading) return;
    isLoading = true;
    $('refreshBtn').disabled = true;
    $('generateBtn').disabled = !selectedPeriod || !isEligibleIndex(getStartIndex(selectedPeriod));
    $('refreshBtn').textContent = '更新中…';
    setStatus('正在抓取台彩歷史資料', 'loading');
    try {
      const loaded = await loadHistory(Boolean(force));
      draws = loaded.draws;
      dataSourceWarning = '';
      renderLatest();
      const recent = draws.slice(0, PICKER_COUNT);
      const defaultEligible = recent.find(draw => isEligibleIndex(getStartIndex(draw.period)));
      if (!selectedPeriod || !recent.some(draw => String(draw.period) === String(selectedPeriod))) {
        selectedPeriod = defaultEligible ? defaultEligible.period : null;
      }
      renderDrawOptions();
      renderSelectionContext();
      setStatus(loaded.source === 'cache' ? '使用瀏覽器快取' : '歷史資料已更新', 'ok');
      if (loaded.source === 'cache') {
        showNotice(`目前使用瀏覽器快取資料（快取時間：${new Date(loaded.cachedAt).toLocaleString('zh-TW')}）。按「更新資料」可強制重新抓取。`, 'warning', 'pickerNotice');
      } else {
        showNotice(`已載入 ${draws.length} 期今彩539資料（${draws[draws.length - 1].period} ～ ${draws[0].period}）；分析時會再依所選 D0 顯示實際訓練範圍。`, 'info', 'pickerNotice');
      }
    } catch (error) {
      console.error(error);
      const cached = readCache();
      const cachedDraws = cached && Array.isArray(cached.draws) && cached.draws.length >= HISTORY_COUNT
        ? cached.draws.slice(0, HISTORY_COUNT)
        : [];
      const bundledDraws = getBundledHistory();
      const fallbackDraws = cachedDraws.length ? cachedDraws : bundledDraws;
      if (fallbackDraws.length >= HISTORY_COUNT) {
        draws = fallbackDraws;
        renderLatest();
        const recent = draws.slice(0, PICKER_COUNT);
        const defaultEligible = recent.find(draw => isEligibleIndex(getStartIndex(draw.period)));
        if (!selectedPeriod || !draws.some(draw => String(draw.period) === String(selectedPeriod))) {
          selectedPeriod = defaultEligible ? defaultEligible.period : null;
        }
        renderDrawOptions();
        renderSelectionContext();
        const sourceLabel = cachedDraws.length ? '瀏覽器快取' : '隨附內建資料';
        setStatus(`即時更新失敗，使用${sourceLabel}`, 'error');
        const freshness = cachedDraws.length
          ? `快取時間：${new Date(cached.savedAt).toLocaleString('zh-TW')}`
          : `內建資料最新期別：${draws[0].period}。內建備援資料沒有日期欄位，成功連線後會以台彩資料更新日期。`;
        dataSourceWarning = `即時資料更新失敗，目前使用${sourceLabel}；${freshness}`;
        showNotice(addDataSourceWarning(`仍可正常操作，背景更新失敗不會阻擋預測。`), 'warning', 'pickerNotice');
      } else {
        setStatus('資料載入失敗', 'error');
        draws = [];
        selectedPeriod = null;
        renderLatest();
        $('generateBtn').disabled = true;
        $('drawOptions').innerHTML = '<div class="loading-card">目前無法取得歷史資料。請檢查網路連線，或稍後按「更新資料」重試。</div>';
        showNotice(`無法取得台彩歷史資料：${error.message}。`, 'error', 'pickerNotice');
      }
    } finally {
      isLoading = false;
      $('refreshBtn').disabled = false;
      $('refreshBtn').textContent = '↻ 更新資料';
      $('generateBtn').disabled = !selectedPeriod || !isEligibleIndex(getStartIndex(selectedPeriod));
      renderSelectionContext();
    }
  }

  document.querySelectorAll('.mode-option').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.mode === selectedModeId) return;
      selectedModeId = button.dataset.mode;
      if (!isEligibleIndex(getStartIndex(selectedPeriod))) {
        const nextEligible = draws.slice(0, PICKER_COUNT).find(draw => isEligibleIndex(getStartIndex(draw.period)));
        selectedPeriod = nextEligible ? nextEligible.period : null;
      }
      lastResult = null;
      $('resultPanel').classList.add('hidden');
      renderModeSettings();
      renderDrawOptions();
      renderSelectionContext();
    });
  });

  $('refreshBtn').addEventListener('click', () => refreshData(true));
  $('generateBtn').addEventListener('click', runAnalysis);
  renderModeSettings();
  draws = getBundledHistory();
  if (draws.length >= HISTORY_COUNT) {
    renderLatest();
    const firstEligible = draws.slice(0, PICKER_COUNT).find(draw => isEligibleIndex(getStartIndex(draw.period)));
    selectedPeriod = firstEligible ? firstEligible.period : null;
    renderDrawOptions();
    renderSelectionContext();
    dataSourceWarning = `目前先使用內建備援資料（最新期別 ${draws[0].period}），背景仍在嘗試更新即時資料。`;
    setStatus('已載入內建備援資料，背景更新中', 'loading');
    showNotice(addDataSourceWarning('不必等待網路即可查看最近15期與產生候選。'), 'info', 'pickerNotice');
  }
  refreshData(false);
})();
