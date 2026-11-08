(function () {
  'use strict';

  const API_URL = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result';
  const CONTENT_KEY = 'daily539Res';
  const DATA_ANCHOR_PERIOD = 115000070;
  const MONTHS_TO_FETCH = 12;
  const REQUEST_TIMEOUT_MS = 18000;
  const CACHE_KEY = '539-v79-live-cache-v1';
  const LEDGER_KEY = '539-v79-live-ledger-v1';
  const MAX_LEDGER = 300;
  const APP_VERSION = '539 DATA LAB v7.9';
  const $ = id => document.getElementById(id);

  let draws = [];
  let forecast = null;
  let loading = false;
  let latestDataSource = 'none';

  function pad2(number) { return String(number).padStart(2, '0'); }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function formatDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}/${match[2]}/${match[3]}` : String(value || '—');
  }
  function formatLocalTime(value) {
    return new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  }
  function monthKey(year, monthIndex) { return `${year}-${String(monthIndex + 1).padStart(2, '0')}`; }
  function buildMonthRange() {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    const months = [];
    for (let offset = 0; offset < MONTHS_TO_FETCH; offset += 1) {
      const month = new Date(end.getFullYear(), end.getMonth() - offset, 1);
      months.push(monthKey(month.getFullYear(), month.getMonth()));
    }
    return months;
  }
  function setSourceStatus(message, type) {
    $('sourceText').textContent = message;
    $('sourceBadge').className = `source-badge ${type || 'ok'}`;
  }
  function setLoading(value) {
    loading = value;
    $('refreshBtn').disabled = value;
    $('refreshBtn').textContent = value ? '更新中…' : '↻ 更新最新資料';
  }
  function normalizeDraw(row) {
    let raw = row && row.drawNumberAppear;
    if (typeof raw === 'string') raw = raw.split(/[,，、\s]+/).filter(Boolean);
    if (!Array.isArray(raw)) return null;
    const numbers = raw.map(Number);
    const period = String(row.period || '').trim();
    const date = String(row.lotteryDate || '').slice(0, 10);
    if (!/^\d{9}$/.test(period) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (numbers.length !== 5 || numbers.some(number => !Number.isInteger(number) || number < 1 || number > 39) || new Set(numbers).size !== 5) return null;
    return { period, date, numbers: numbers.slice().sort((a, b) => a - b) };
  }
  async function fetchMonth(month) {
    const url = new URL(API_URL);
    url.searchParams.set('month', month);
    url.searchParams.set('pageSize', '500');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url.toString(), {
        method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal
      });
      if (!response.ok) throw new Error(`台彩資料介面回應 HTTP ${response.status}（${month}）`);
      const json = await response.json();
      const rows = json && json.content && json.content[CONTENT_KEY];
      if (!Array.isArray(rows)) throw new Error(`台彩資料格式異動：${month} 找不到 ${CONTENT_KEY}`);
      return rows;
    } finally { clearTimeout(timeout); }
  }
  function sortDraws(items) {
    const byPeriod = new Map();
    items.forEach(item => { if (item) byPeriod.set(item.period, item); });
    return Array.from(byPeriod.values()).sort((a, b) =>
      b.date.localeCompare(a.date) || Number(b.period) - Number(a.period)
    );
  }
  async function fetchLatestHistory() {
    const months = buildMonthRange();
    if (!months.length) throw new Error('無法建立資料查詢月份。');
    const batchSize = 4;
    const allRows = [];
    const failures = [];
    for (let index = 0; index < months.length; index += batchSize) {
      const batch = months.slice(index, index + batchSize);
      const results = await Promise.all(batch.map(async month => {
        try { return { month, rows: await fetchMonth(month) }; }
        catch (error) { return { month, error }; }
      }));
      results.forEach(result => {
        if (result.error) failures.push(`${result.month}: ${result.error.message}`);
        else allRows.push(...result.rows);
      });
    }
    if (failures.length) throw new Error(`部分月份資料未能完整取得：${failures.join('；')}`);
    const normalized = allRows.map(normalizeDraw).filter(draw => draw && Number(draw.period) >= DATA_ANCHOR_PERIOD);
    const sorted = sortDraws(normalized);
    if (sorted.length < 55) throw new Error(`有效歷史資料只有 ${sorted.length} 期，至少需要55期。`);
    if (Number(sorted[0].period) < DATA_ANCHOR_PERIOD) throw new Error('最新期別驗證失敗。');
    return sorted;
  }
  function readCache() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return value && Array.isArray(value.draws) && value.savedAt ? value : null;
    } catch (_) { return null; }
  }
  function writeCache(items) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), draws: items })); }
    catch (_) { /* private browsing or storage quota */ }
  }
  function readLedger() {
    try {
      const value = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  }
  function saveForecastSnapshot(current) {
    const ledger = readLedger();
    const existing = ledger.find(row => String(row.targetPeriod) === String(current.targetPeriod) && String(row.d0Period) === String(current.d0.period));
    if (existing) return { saved: false, existing };
    const snapshot = {
      version: 'v7.9',
      model: 'Average Count / T49 / Prior50 / TOP15 / D1-D4 / Pick2',
      targetPeriod: current.targetPeriod,
      d0Period: current.d0.period,
      d0Numbers: current.d0.numbers.slice(),
      d1d4: current.d1ToD4.map(draw => ({ period: draw.period, date: draw.date, numbers: draw.numbers.slice() })),
      picks: current.picks.slice(),
      top15: current.top15.map(item => item.number),
      survivors: current.survivors.map(item => item.number),
      scores: { ...current.scoreMap },
      triggerSamples: current.transition.perTrigger.map(item => ({ trigger: item.trigger, samples: item.samples })),
      dataCount: current.dataCount,
      trainWindow: current.historyCount,
      historyStart: current.historyStart,
      historyEnd: current.historyEnd,
      savedAt: new Date().toISOString()
    };
    ledger.unshift(snapshot);
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger.slice(0, MAX_LEDGER))); }
    catch (_) { /* best effort */ }
    return { saved: true, existing: snapshot };
  }
  function drawBallMarkup(number, className = '') {
    return `<span class="mini-ball ${className}">${pad2(number)}</span>`;
  }
  function renderLatest() {
    const latest = draws[0];
    $('latestPeriod').textContent = latest ? latest.period : '—';
    $('latestDate').textContent = latest ? formatDate(latest.date) : '尚未取得資料';
    $('latestBalls').innerHTML = latest ? latest.numbers.map(number => `<span class="ball">${pad2(number)}</span>`).join('') : '';
    $('drawCount').textContent = `${draws.length} 期`;
    $('rangeText').textContent = draws.length ? `${formatDate(draws[draws.length - 1].date)} ～ ${formatDate(draws[0].date)}` : '—';
  }
  function renderContext() {
    if (!forecast) return;
    const chronological = [forecast.d0, ...forecast.d1ToD4];
    $('contextGrid').innerHTML = chronological.map((draw, index) => `
      <div class="context-item ${index === 0 ? 'd0' : ''}">
        <div class="context-label"><span>${index === 0 ? '觸發起始期' : `排除 D${index}`}</span><span>D${index}</span></div>
        <div class="context-period">${escapeHtml(draw.period)}</div>
        <div class="context-balls">${draw.numbers.map(number => drawBallMarkup(number)).join('')}</div>
      </div>`).join('');
    $('excludedNumbers').innerHTML = forecast.excludedNumbers.map(number => `<span class="excluded-ball">${pad2(number)}</span>`).join('');
    $('targetPeriod').textContent = forecast.targetPeriod;
    $('forecastSubtitle').textContent = `D0 ${forecast.d0.period} → D1～D4 已完整開出 → 預測 D5；固定使用D0以前最近49期訓練。`;
  }
  function renderForecast() {
    if (!forecast) return;
    const picks = forecast.picks;
    $('modelGrid').innerHTML = `
      <article class="model-card v79-card">
        <div class="model-head"><div><div class="v79-version">唯一啟用模型 · ${escapeHtml(forecast.version)}</div><h3>Average Count</h3><div class="model-subtitle">最近49期訓練 · Prior50 · 五個D0觸發號碼等權平均</div></div><span class="model-tag v79-tag">V7.9</span></div>
        <div class="v79-config"><span>T49 訓練</span><span>Prior50</span><span>TOP15</span><span>排除D1～D4</span><span>固定選2碼</span></div>
        <div class="picks-wrap">${picks.length ? picks.map((number, index) => `<div class="pick-item"><span class="pick-ball">${pad2(number)}</span><small>第${index + 1}選 · 存活排名 ${forecast.survivors[index].finalRank}</small></div>`).join('') : '<span class="pick-empty">TOP15排除後沒有可選號碼。</span>'}</div>
        <div class="model-stats"><span class="model-stat">49期訓練：${forecast.historyStart}～${forecast.historyEnd}</span><span class="model-stat">五觸發有效樣本：${forecast.transition.sampleCount}</span><span class="model-stat">存活候選：${forecast.survivors.length}碼</span><span class="model-stat">先驗強度：50</span></div>
      </article>`;
    $('overlapPanel').innerHTML = `<strong>v7.9 固定演算規格</strong><p>對每個D0觸發號碼，統計其在最近49期歷史中出現後，接續五期內各號碼的總出現次數；依 (次數 + 50×5/39) ÷ (5×有效樣本數 + 50) 平滑，五個觸發號碼等權平均。39碼排序後取TOP15，再排除D1～D4，保留前2碼。</p>`;
  }
  function renderModelDetail() {
    if (!forecast) return;
    const survivorMap = new Map(forecast.survivors.map(item => [item.number, item]));
    const topMap = new Map(forecast.top15.map(item => [item.number, item]));
    const eliminatedMap = new Map(forecast.eliminated.map(item => [item.number, item]));
    const selected = new Set(forecast.picks);
    const rows = forecast.ranking.map(item => {
      const inTop = topMap.has(item.number);
      const survivor = survivorMap.get(item.number);
      const eliminated = eliminatedMap.get(item.number);
      const state = !inTop ? '<span class="state-pool">TOP15以外</span>' : survivor
        ? `<span class="state-kept">保留第${survivor.finalRank}名${selected.has(item.number) ? ' · 本次選取' : ''}</span>`
        : `<span class="state-removed">已排除${eliminated?.appearedIn?.length ? ` · ${eliminated.appearedIn.map(draw => escapeHtml(draw.period)).join('、')}` : ' · D1～D4'}</span>`;
      return `<tr class="${selected.has(item.number) ? 'selected-row' : inTop ? 'top-row' : ''}"><td>${item.originalRank}</td><td class="num-cell">${pad2(item.number)}</td><td>${(item.score * 100).toFixed(5)}%</td><td>${state}</td></tr>`;
    }).join('');
    $('modelDetail').innerHTML = `
      <div class="detail-head"><div><strong>v7.9 Average Count 完整39碼排名</strong><br><small>D0觸發號碼：${forecast.d0.numbers.map(pad2).join('、')}</small></div><span class="tag">T49 · Prior50</span></div>
      <div class="detail-chips"><span class="detail-chip">各觸發有效樣本：${forecast.transition.perTrigger.map(item => `${pad2(item.trigger)}=${item.samples}`).join(' ／ ')}</span><span class="detail-chip">排序：分數高至低，同分小號優先</span><span class="detail-chip">TOP15 → 排除D1～D4 → 取存活前2</span></div>
      <div class="table-wrap"><table class="ranking-table"><thead><tr><th>排名</th><th>號碼</th><th>Average Count 分數</th><th>候選狀態</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function renderArchive() {
    const ledger = readLedger();
    $('archiveBody').innerHTML = ledger.length ? ledger.slice(0, 60).map(row => `
      <tr><td>${escapeHtml(formatLocalTime(row.savedAt))}</td><td>${escapeHtml(row.targetPeriod)}</td><td><strong>v7.9 Average Count</strong></td><td><span class="archive-picks">${row.picks.map(number => `<span class="archive-pick">${pad2(number)}</span>`).join('')}</span></td><td>${escapeHtml(row.d0Period)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-cell">尚無封存紀錄</td></tr>';
  }
  function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
  function exportLedger() {
    const ledger = readLedger();
    if (!ledger.length) { alert('目前沒有v7.9預測封存紀錄可以匯出。'); return; }
    const headers = ['version','saved_at','target_period','d0_period','d0_numbers','pick_1','pick_2','train_window','prior_strength','top15','survivors','history_start','history_end','data_count'];
    const lines = [headers.join(',')];
    ledger.forEach(row => lines.push([
      row.version, row.savedAt, row.targetPeriod, row.d0Period, row.d0Numbers.map(pad2).join(' '),
      row.picks[0] ? pad2(row.picks[0]) : '', row.picks[1] ? pad2(row.picks[1]) : '',
      49, 50, row.top15.map(pad2).join(' '), row.survivors.map(pad2).join(' '),
      row.historyStart, row.historyEnd, row.dataCount
    ].map(csvEscape).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '539_v79_prediction_ledger.csv'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function recalculate() {
    if (loading) return;
    setLoading(true);
    $('errorPanel').classList.add('hidden');
    $('fallbackPanel').classList.add('hidden');
    setSourceStatus('正在更新台彩歷史資料', 'loading');
    try {
      let updated;
      try {
        updated = await fetchLatestHistory();
        latestDataSource = 'live';
        writeCache(updated);
        setSourceStatus('已連線官方資料介面', 'ok');
      } catch (networkError) {
        const cached = readCache();
        if (!cached || !Array.isArray(cached.draws) || cached.draws.length < 55) throw networkError;
        updated = cached.draws;
        latestDataSource = 'cache';
        setSourceStatus('即時更新失敗・使用快取', 'error');
        $('fallbackPanel').textContent = `即時資料抓取失敗：${networkError.message}。目前改用本機快取（保存時間：${formatLocalTime(cached.savedAt)}），以下v7.9預測可能不是最新資料，請先確認最新期別。`;
        $('fallbackPanel').classList.remove('hidden');
      }
      draws = updated;
      forecast = window.M539V79Model.buildPrediction({ drawsNewestFirst: draws, startIndex: 4, historyAnchorPeriod: String(DATA_ANCHOR_PERIOD) });
      renderLatest();
      renderContext();
      renderForecast();
      renderModelDetail();
      const saved = saveForecastSnapshot(forecast);
      renderArchive();
      $('updatedAt').textContent = `${latestDataSource === 'live' ? '即時更新完成' : '快取資料'} · ${formatLocalTime(new Date().toISOString())}`;
      $('updatedAt').textContent += saved.saved ? ' · 本期v7.9預測已封存' : ' · 本期已有首次封存紀錄，未覆寫';
    } catch (error) {
      console.error(error);
      setSourceStatus('資料讀取失敗', 'error');
      $('errorPanel').textContent = `無法產生v7.9預測：${error.message}。請按「更新最新資料」重試；若持續失敗，可能是台灣彩券資料介面或跨網域政策變更。`;
      $('errorPanel').classList.remove('hidden');
      $('modelGrid').innerHTML = '<div class="model-loading">資料不可用，暫不產生預測。避免使用未驗證或過期資料。</div>';
      forecast = null;
    } finally {
      setLoading(false);
    }
  }

  $('refreshBtn').addEventListener('click', recalculate);
  $('exportBtn').addEventListener('click', exportLedger);
  renderArchive();
  recalculate();
})();
