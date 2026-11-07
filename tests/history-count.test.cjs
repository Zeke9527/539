const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync(require.resolve('../assets/app.js'), 'utf8');
assert.match(app, /const HISTORY_COUNT = 200;/);
assert.match(app, /if \(sorted\.length < HISTORY_COUNT\)/, 'must reject fewer than 200 API records');
assert.match(app, /cached\.draws\.length >= HISTORY_COUNT/, 'cache fallback must also require 200 records');
assert.match(app, /m539-final-v7-3-draw-cache/, 'must not reuse the previous version cache');
console.log('PASS: v7.3 requires 200 real records and refuses partial cache fallback.');
