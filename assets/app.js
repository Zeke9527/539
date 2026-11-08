(function () {
  'use strict';

  const API_URL = 'https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Daily539Result';
  const CONTENT_KEY = 'daily539Res';
  const DATA_ANCHOR_PERIOD = 115000070;
  const FIRST_MONTH = '2026-01';
  const REQUEST_TIMEOUT_MS = 18000;
  const CACHE_KEY = '539-three-model-live-cache-v1';
  const LEDGER_KEY = '539-three-model-live-ledger-v1';
  const MAX_LEDGER = 300;
  const $ = id => document.getElementById(id);

  let draws = [];
  let forecast = null;
  let activeModelId = 'v79_avgcount_t49_p50';
  let loading = false;
  let latestDataSource = 'none';

  const MODEL_LABELS = {
    v781_full_p10: 'v7.8.1 正式版',
    v781_t49_p10: 'v7.8.1 T49 對照版',
    v79_avgcount_t49_p50: 'v7.9-shadow Average Count'
  };

  function pad2(n) { return String(n).padStart(2, '0'); }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatDate(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}/${m[2]}/${m[3]}` : String(value || '—');
  }
  function formatLocalTime(value) {
    return new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  }
  function monthKey(year, monthIndex) { return `${year}-${String(monthIndex + 1).padStart(2, '0')}`; }
  function buildMonthRange() {
    const now = new Date();
    const [startYear, startMonth] = FIRST_MONTH.split('-').map(Number);
    const start = new Date(startYear, startMonth - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    const months = [];
    while (start <= end && months.length < 36) {
      months.push(monthKey(start.getFullYear(), start.getMonth()));
      start.setMonth(start.getMonth() + 1);
    }
    return months;
  }
  function setSourceStatus(text, type) {
    $('sourceText').textContent = text;
    $('sourceBadge').className = `source-badge ${type || 'ok'}`;
  }
  function setLoading(isLoading) {
    loading = isLoading;
    $('refreshBtn').disabled = isLoading;
    $('refreshBtn').textContent = isLoading ? '更新中…' : '↻ 更新最新資料';
  }
  function normalizeDraw(row) {
    let raw = row && row.drawNumberAppear;
    if (typeof raw === 'string') raw = raw.split(/[,，、\s]+/).filter(Boolean);
    if (!Array.isArray(raw)) return null;
    const numbers = raw.map(Number);
    const period = String(row.period || '').trim();
    const date = String(row.lotteryDate || '').slice(0, 10);
    if (!/^\d{9}$/.test(period) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (numbers.length !== 5 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 39) || new Set(numbers).size !== 5) return null;
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
    // Fetch every month since the project's fixed research anchor year. Any failed month
    // makes the full-history track incomplete, so do not silently calculate from a gap.
    const batchSize = 4;
    const allRows = [];
    const failures = [];
    for (let i = 0; i < months.length; i += batchSize) {
      const batch = months.slice(i, i + batchSize);
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
      if (!value || !Array.isArray(value.draws) || !value.savedAt) return null;
      return value;
    } catch (_) { return null; }
  }
  function writeCache(items) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), draws: items })); } catch (_) { /* private browsing or storage quota */ }
  }
  function readLedger() {
    try {
      const value = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  }
  function saveForecastSnapshot(current) {
    const ledger = readLedger();
    const target = current.targetPeriod;
    const existing = ledger.find(row => String(row.targetPeriod) === String(target));
    if (existing) return { saved: false, existing };
    const snapshot = {
      targetPeriod: target,
      d0Period: current.d0.period,
      d0Numbers: current.d0.numbers.slice(),
      d1d4: current.d1ToD4.map(d => ({ period: d.period, date: d.date, numbers: d.numbers.slice() })),
      models: current.models.map(m => ({ id: m.id, name: m.name, picks: m.picks.slice(), top15: m.top15.map(x => x.number), survivors: m.survivors.map(x => x.number), scores: { ...m.scoreMap } })),
      dataCount: current.dataCount,
      historyCount: current.historyCount,
      historyStart: current.historyStart,
      historyEnd: current.historyEnd,
      savedAt: new Date().toISOString(),
      appVersion: '1.0.0'
    };
    ledger.unshift(snapshot);
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger.slice(0, MAX_LEDGER))); } catch (_) { /* best effort */ }
    return { saved: true, existing: snapshot };
  }
  function drawBallMarkup(number, className = '') {
    return `<span class="mini-ball ${className}">${pad2(number)}</span>`;
  }
  function renderLatest() {
    const latest = draws[0];
    $('latestPeriod').textContent = latest ? latest.period : '—';
    $('latestDate').textContent = latest ? formatDate(latest.date) : '尚未取得資料';
    $('latestBalls').innerHTML = latest ? latest.numbers.map(n => `<span class="ball">${pad2(n)}</span>`).join('') : '';
    $('drawCount').textContent = `${draws.length} 期`;
  }
  function renderContext() {
    if (!forecast) return;
    const chronological = [forecast.d0, ...forecast.d1ToD4];
    $('contextGrid').innerHTML = chronological.map((draw, i) => `
      <div class="context-item ${i === 0 ? 'd0' : ''}">
        <div class="context-label"><span>${i === 0 ? '觸發起始期' : `排除 D${i}`}</span><span>D${i}</span></div>
        <div class="context-period">${escapeHtml(draw.period)}</div>
        <div class="context-balls">${draw.numbers.map(n => drawBallMarkup(n)).join('')}</div>
      </div>`).join('');
    $('excludedNumbers').innerHTML = forecast.excludedNumbers.map(n => `<span class="excluded-ball">${pad2(n)}</span>`).join('');
    $('targetPeriod').textContent = forecast.targetPeriod;
    $('forecastSubtitle').textContent = `D0 ${forecast.d0.period} → D1～D4 已完整開出 → 預測 D5 ${forecast.targetPeriod}；每種模型固定輸出2碼。`;
  }
  function modelTag(model) {
    return model.id === 'v79_avgcount_t49_p50' ? '<span class="model-tag shadow">研究影子模型</span>' : '<span class="model-tag">正式基準／對照</span>';
  }
  function renderModels() {
    if (!forecast) return;
    $('modelGrid').innerHTML = forecast.models.map(model => `
      <article class="model-card ${model.id === 'v79_avgcount_t49_p50' ? 'shadow-model' : ''}">
        <div class="model-head"><div><h3>${escapeHtml(model.name)}</h3><div class="model-subtitle">${escapeHtml(model.subtitle)}</div></div>${modelTag(model)}</div>
        <div class="picks-wrap">${model.picks.length ? model.picks.map((n, i) => `<div class="pick-item"><span class="pick-ball">${pad2(n)}</span><small>第${i + 1}選</small></div>`).join('') : '<span class="pick-empty">TOP15排除後無可選號碼</span>'}</div>
        <div class="model-stats">
          <span class="model-stat">訓練 ${model.historyCount} 期</span>
          <span class="model-stat">TOP15</span>
          <span class="model-stat">存活 ${model.survivors.length} 碼</span>
          <span class="model-stat">Prior ${model.prior}</span>
        </div>
        <div class="model-foot"><span class="rank-hint">依分數排序，同分小號優先</span><button class="text-link" type="button" data-detail="${model.id}">查看完整排名 →</button></div>
      </article>`).join('');
    $('modelGrid').querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => selectModel(button.dataset.detail, true)));

    const overlaps = forecast.overlaps.filter(x => x.count > 1);
    $('overlapPanel').innerHTML = `<strong>三模型重複選號</strong><div class="overlap-list">${overlaps.length ? overlaps.map(x => `<span class="overlap-chip">${pad2(x.number)} · ${x.count}/3模型</span>`).join('') : '<span class="rank-hint">三模型前兩碼沒有重複</span>'}</div><p>重複選號代表模型排序有交集，不代表該號碼的客觀開出機率較高。</p>`;
  }
  function selectModel(id, scroll) {
    activeModelId = id;
    renderModelTabs();
    renderModelDetail();
    if (scroll) $('modelDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderModelTabs() {
    if (!forecast) return;
    $('modelTabs').innerHTML = forecast.models.map(m => `<button class="tab ${m.id === activeModelId ? 'active' : ''}" type="button" role="tab" aria-selected="${m.id === activeModelId}" data-tab="${m.id}">${escapeHtml(MODEL_LABELS[m.id] || m.name)}</button>`).join('');
    $('modelTabs').querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => selectModel(button.dataset.tab, false)));
  }
  function renderModelDetail() {
    if (!forecast) return;
    const model = forecast.models.find(m => m.id === activeModelId) || forecast.models[0];
    const survivorMap = new Map(model.survivors.map(x => [x.number, x]));
    const topMap = new Map(model.top15.map(x => [x.number, x]));
    const selected = new Set(model.picks);
    const rows = model.ranking.map(item => {
      const inTop = topMap.has(item.number);
      const survivor = survivorMap.get(item.number);
      const state = !inTop ? '<span class="state-pool">TOP15以外</span>' : survivor
        ? `<span class="state-kept">保留第${survivor.finalRank}名${selected.has(item.number) ? ' · 本次選取' : ''}</span>`
        : '<span class="state-removed">已被D1～D4排除</span>';
      return `<tr class="${selected.has(item.number) ? 'selected-row' : inTop ? 'top-row' : ''}"><td>${item.originalRank}</td><td class="num-cell">${pad2(item.number)}</td><td>${(item.score * 100).toFixed(5)}%</td><td>${state}</td></tr>`;
    }).join('');
    $('modelDetail').innerHTML = `
      <div class="detail-head"><div><strong>${escapeHtml(model.name)}</strong><br><small>${escapeHtml(model.subtitle)} · D0 觸發：${forecast.d0.numbers.map(pad2).join('、')}</small></div><span class="tag">訓練 ${model.historyCount} 期</span></div>
      <div class="detail-chips"><span class="detail-chip">有效歷史觸發樣本：${model.triggerSamples.map(x => `${pad2(x.trigger)}=${x.samples}`).join(' ／ ')}</span><span class="detail-chip">TOP15 → 排除D1～D4 → 前2碼</span></div>
      <div class="table-wrap"><table class="ranking-table"><thead><tr><th>排名</th><th>號碼</th><th>模型分數</th><th>候選狀態</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function renderArchive() {
    const ledger = readLedger();
    $('archiveBody').innerHTML = ledger.length ? ledger.slice(0, 60).map(row => row.models.map(model => `
      <tr><td>${escapeHtml(formatLocalTime(row.savedAt))}</td><td>${escapeHtml(row.targetPeriod)}</td><td>${escapeHtml(model.name)}</td><td><span class="archive-picks">${model.picks.map(n => `<span class="archive-pick">${pad2(n)}</span>`).join('')}</span></td><td>${escapeHtml(row.d0Period)}</td></tr>`).join('')).join('') : '<tr><td colspan="5" class="empty-cell">尚無封存紀錄</td></tr>';
  }
  function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
  function exportLedger() {
    const ledger = readLedger();
    if (!ledger.length) { alert('目前沒有預測封存紀錄可以匯出。'); return; }
    const headers = ['saved_at','target_period','d0_period','model_id','model_name','pick_1','pick_2','train_count','data_count','history_start','history_end'];
    const lines = [headers.join(',')];
    ledger.forEach(row => row.models.forEach(model => lines.push([
      row.savedAt, row.targetPeriod, row.d0Period, model.id, model.name,
      model.picks[0] ? pad2(model.picks[0]) : '', model.picks[1] ? pad2(model.picks[1]) : '',
      model.id === 'v781_full_p10' ? row.historyCount : 49, row.dataCount, row.historyStart, row.historyEnd
    ].map(csvEscape).join(','))));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '539_three_model_live_prediction_ledger.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function recalculate(forceNetwork) {
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
        $('fallbackPanel').textContent = `即時資料抓取失敗：${networkError.message}。目前改用本機快取（保存時間：${formatLocalTime(cached.savedAt)}），以下預測可能不是最新資料，請確認最新期別後再使用。`;
        $('fallbackPanel').classList.remove('hidden');
      }
      draws = updated;
      forecast = window.M539ThreeModel.buildPrediction({ drawsNewestFirst: draws, startIndex: 4, historyAnchorPeriod: String(DATA_ANCHOR_PERIOD) });
      renderLatest();
      renderContext();
      renderModels();
      renderModelTabs();
      renderModelDetail();
      const saved = saveForecastSnapshot(forecast);
      renderArchive();
      $('updatedAt').textContent = `${latestDataSource === 'live' ? '即時更新完成' : '快取資料'} · ${formatLocalTime(new Date().toISOString())}`;
      if (saved.saved) {
        $('updatedAt').textContent += ' · 本期預測已封存';
      } else {
        $('updatedAt').textContent += ' · 本期已有首次封存紀錄，未覆寫';
      }
      if (latestDataSource === 'live') {
        $('errorPanel').classList.add('hidden');
      }
    } catch (error) {
      console.error(error);
      setSourceStatus('資料讀取失敗', 'error');
      $('errorPanel').textContent = `無法產生即時預測：${error.message}。請按「更新最新資料」重試；若持續失敗，可能是台灣彩券資料介面或跨網域政策變更。`;
      $('errorPanel').classList.remove('hidden');
      $('modelGrid').innerHTML = '<div class="model-loading">資料不可用，暫不產生預測。避免使用未驗證或過期資料。</div>';
    } finally {
      setLoading(false);
    }
  }

  $('refreshBtn').addEventListener('click', () => recalculate(true));
  $('exportBtn').addEventListener('click', exportLedger);
  renderArchive();
  recalculate(false);
})();
