(function () {
  'use strict';

  const API_URL = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result';
  const CONTENT_KEY = 'daily539Res';
  const CACHE_KEY = 'm539-draw-cache-v1';
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 15000;
  const $ = id => document.getElementById(id);
  let draws = [];
  let isLoading = false;
  let hasUserEditedNumbers = false;

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

  function showNotice(message, type) {
    const notice = $('notice');
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
    if (sorted.length < requestedCount) {
      showNotice(`資料來源目前只提供 ${sorted.length} 期有效紀錄；本次以這些資料分析，實際可用期數已在頁面標示。`, 'warning');
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
    return mode === 'six' ? '六窗口模型' : mode === 'hybrid' ? '綜合模型（轉移70%＋六窗口30%）' : '後五期轉移模型';
  }

  function renderPrediction(result) {
    const mode = result.mode;
    $('resultTitle').textContent = `候選 ${result.count} 碼`;
    $('resultMode').textContent = getModeLabel(mode);
    $('resultBalls').innerHTML = result.picks.map((item, index) => `
      <div class="pick-ball-wrap"><span class="pick-ball">${pad2(item.number)}</span><span class="pick-rank">第 ${index + 1} 名</span></div>`).join('');

    const support = result.transition.perTrigger.map(item => `${pad2(item.trigger)}：${item.samples} 組`).join('　／　');
    $('sampleSummary').textContent = `各觸發號碼的完整歷史樣本數：${support}。合計 ${result.transition.sampleCount} 個觸發樣本。`;
    $('baselineSummary').textContent = `任意指定號碼在未來五期至少出現一次的理論基準約 ${(result.transition.priorProbability * 100).toFixed(1)}%；轉移模型以此作為平滑先驗，並非預測保證。`;

    const tableRows = result.candidates.slice(0, 12).map((item, index) => {
      const transitionText = `${(item.transitionRate * 100).toFixed(1)}%`;
      const windowText = item.sixWindowScore.toFixed(3);
      const detail = item.perTrigger.map(part => `${pad2(part.trigger)}：${part.hits}/${part.samples || 0}`).join('；');
      const scoreText = mode === 'six' ? item.sixWindowZ.toFixed(3) : mode === 'hybrid' ? item.combinedScore.toFixed(3) : transitionText;
      return `<tr${index < result.count ? ' class="selected-row"' : ''}>
        <td>${index + 1}</td><td><strong>${pad2(item.number)}</strong></td><td>${scoreText}</td>
        <td>${transitionText}</td><td>${windowText}</td><td class="detail-cell" title="${escapeHtml(detail)}">${escapeHtml(detail)}</td></tr>`;
    }).join('');
    $('rankingTable').innerHTML = `<table><thead><tr><th>排名</th><th>號碼</th><th>模型分數</th><th>轉移估計</th><th>六窗口分數</th><th>各觸發號碼命中／樣本</th></tr></thead><tbody>${tableRows}</tbody></table>`;

    $('triggerSupport').innerHTML = result.transition.perTrigger.map(item => `
      <div class="support-card"><div class="support-number">${pad2(item.trigger)}</div>
      <div><strong>${item.samples} 組完整樣本</strong><small>在歷史上開出 ${pad2(item.trigger)} 後，觀察接下來五期</small></div></div>`).join('');
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
      $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      $('resultPanel').classList.add('hidden');
      showNotice(error.message || '分析失敗，請檢查輸入內容。', 'error');
    }
  }

  async function refreshData(force) {
    if (isLoading) return;
    isLoading = true;
    $('refreshBtn').disabled = true;
    $('generateBtn').disabled = true;
    $('refreshBtn').textContent = '更新中…';
    setStatus('正在抓取台彩歷史資料', 'loading');
    if (!force) showNotice('', 'info');
    try {
      const requestedCount = Number($('historyCount').value) || 200;
      const result = await loadHistory(requestedCount, Boolean(force));
      draws = result.draws;
      renderLatest();
      if (!hasUserEditedNumbers || !$('triggerInput').value.trim()) fillLatestNumbers();
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
    }
  }

  $('generateBtn').addEventListener('click', runAnalysis);
  $('refreshBtn').addEventListener('click', () => refreshData(true));
  $('useLatestBtn').addEventListener('click', fillLatestNumbers);
  $('historyCount').addEventListener('change', () => refreshData(false));
  $('numberCount').addEventListener('change', () => { if (draws.length) runAnalysis(); });
  $('modelMode').addEventListener('change', () => { if (draws.length) runAnalysis(); });
  $('triggerInput').addEventListener('input', () => {
    hasUserEditedNumbers = true;
    $('triggerIssue').textContent = '自訂觸發號碼；模型會使用目前載入的歷史資料統計轉移關係。';
  });
  $('triggerInput').addEventListener('keydown', event => { if (event.key === 'Enter') runAnalysis(); });

  refreshData(false);
})();
