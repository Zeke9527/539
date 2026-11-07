const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const app = fs.readFileSync(require.resolve('../assets/app.js'), 'utf8');
assert.match(html, /v7\.5\.0/);
assert.match(html, /styles\.css\?v=7\.5\.0/);
assert.match(html, /app\.js\?v=7\.5\.0/);
assert.match(app, /m539-final-v7-5-draw-cache/);
console.log('PASS: v7.5 asset cache busting and isolated browser cache.');
