const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../assets/model.js');

const ids = [
  'appVersion', 'statusText', 'statusDot', 'latestPeriod', 'latestDate', 'latestBalls',
  'drawCount', 'rangeText', 'drawOptions', 'selectionContext', 'pickerNotice',
  'selectedPeriodLabel', 'selectedNumbersLabel', 'generateBtn', 'refreshBtn',
  'historySettingLabel', 'excludeSettingLabel', 'resultPanel'
];
function makeElement(id) {
  return {
    id, textContent: '', innerHTML: '', disabled: false, className: '', dataset: {},
    setAttribute() {}, addEventListener() {}, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {} }, scrollIntoView() {}
  };
}
const elements = Object.fromEntries(ids.map(id => [id, makeElement(id)]));
const document = {
  getElementById(id) { return elements[id] || (elements[id] = makeElement(id)); },
  querySelectorAll() { return []; }
};
const bundleContext = { window: {}, globalThis: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../assets/history-data.js'), 'utf8'), bundleContext);
const window = {
  M539BundledHistory: bundleContext.window.M539BundledHistory,
  M539FinalModel: model
};
const context = {
  window, document,
  localStorage: { getItem() { return null; }, setItem() {} },
  URL, AbortController, Date, Map, Set, Array, Object, Number, String, Math, Promise,
  console: { error() {}, log() {} }, setTimeout, clearTimeout,
  fetch: async () => { throw new Error('offline test'); }
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(require.resolve('../assets/app.js'), 'utf8'), context);

setTimeout(() => {
  const options = (elements.drawOptions.innerHTML.match(/class="draw-option(?: |")/g) || []).length;
  assert.equal(window.M539AppBooted, true);
  assert.equal(elements.latestPeriod.textContent, '115000269');
  assert.equal(options, 15);
  assert.equal(elements.drawOptions.innerHTML.includes('正在讀取最近15期開獎號碼'), false);
  assert.equal(elements.generateBtn.disabled, false, 'fallback data should remain usable during/after failed background fetch');
  assert.match(elements.statusText.textContent, /即時更新失敗/);
  assert.match(elements.pickerNotice.textContent, /內建備援資料/);
  console.log('PASS: app startup renders 15 periods immediately and remains usable when API is offline.');
}, 50);
