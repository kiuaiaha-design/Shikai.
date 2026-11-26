'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const server = require('../server');

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => server.close());

test('/health répond ok', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('la page d’accueil a des URLs OG absolues et une CSP', async () => {
  const r = await fetch(`${base}/`, { headers: { 'x-forwarded-proto': 'https', host: 'exemple.up.railway.app' } });
  const html = await r.text();
  assert.match(html, /og:image" content="https?:\/\/[^"]+\/og\.png"/);
  assert.ok(!html.includes('__ORIGIN__'));
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('les fichiers texte sont compressés et gèrent ETag/304', async () => {
  const r = await fetch(`${base}/app.js`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(r.headers.get('content-encoding'), 'gzip');
  const r2 = await fetch(`${base}/app.js`, { headers: { 'if-none-match': r.headers.get('etag') } });
  assert.equal(r2.status, 304);
});

test('aperçu et icônes existent', async () => {
  for (const f of ['og.png', 'icon-192.png', 'favicon.svg', 'manifest.webmanifest']) {
    assert.equal((await fetch(`${base}/${f}`)).status, 200, f);
  }
});

test('404 et traversée de chemin bloquées', async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  const r = await fetch(`${base}/%2e%2e/server.js`);
  assert.ok([403, 404].includes(r.status));
});

test('API de sauvegarde désactivée sans webhook', async () => {
  const s = await (await fetch(`${base}/api/backup/status`)).json();
  assert.equal(s.enabled, false);
  assert.equal((await fetch(`${base}/api/backup`, { method: 'POST', body: '{}' })).status, 503);
});
