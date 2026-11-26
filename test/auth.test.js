'use strict';
// Connexion Discord + panel admin, avec un faux Discord local (DISCORD_API_BASE).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert');

const FOUNDER = '653263485362503693';
const PROFILES = {
  'code-founder': { id: FOUNDER, username: 'fondateur', global_name: 'Le Fondateur', avatar: null },
  'code-alice': { id: '111111111111111111', username: 'alice', global_name: 'Alice', avatar: null },
  'code-bob': { id: '222222222222222222', username: 'bob', global_name: 'Bob', avatar: null },
};

let mock, server, base;
test.before(async () => {
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/oauth2/token') {
        const code = new URLSearchParams(body).get('code');
        if (!PROFILES[code]) { res.statusCode = 400; return res.end('{}'); }
        return res.end(JSON.stringify({ access_token: code }));
      }
      if (req.url === '/users/@me') {
        const p = PROFILES[String(req.headers.authorization || '').replace('Bearer ', '')];
        if (!p) { res.statusCode = 401; return res.end('{}'); }
        return res.end(JSON.stringify(p));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.DISCORD_API_BASE = `http://127.0.0.1:${mock.address().port}`;
  process.env.DISCORD_CLIENT_ID = '123';
  process.env.DISCORD_CLIENT_SECRET = 'secret-de-test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-'));
  server = require('../server');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); mock.close(); });

async function login(code) {
  const l = await fetch(`${base}/auth/login`, { redirect: 'manual' });
  assert.equal(l.status, 303);
  assert.match(l.headers.get('location'), /^https:\/\/discord\.com\/oauth2\/authorize\?/);
  const state = /sf_state=([^;]+)/.exec(l.headers.get('set-cookie'))[1];
  const cb = await fetch(`${base}/auth/callback?code=${code}&state=${state.split('.')[0]}`, { redirect: 'manual', headers: { cookie: `sf_state=${state}` } });
  assert.equal(cb.status, 303);
  const m = /sf_session=([^;]+)/.exec(cb.headers.getSetCookie().join('\n'));
  assert.ok(m, 'cookie de session');
  return `sf_session=${m[1]}`;
}
const call = (cookie, p, body) => fetch(`${base}${p}`, body
  ? { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }
  : { headers: { cookie } });

test('sans connexion : page de connexion, API fermée, admin redirigé', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /Se connecter avec Discord/);
  assert.equal((await fetch(`${base}/api/backup/status`)).status, 401);
  const a = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(a.status, 303);
  assert.match(a.headers.get('location'), /\/auth\/login/);
});

test('state invalide ou session falsifiée refusés', async () => {
  const cb = await fetch(`${base}/auth/callback?code=code-alice&state=x`, { redirect: 'manual', headers: { cookie: 'sf_state=autre.g' } });
  assert.match(cb.headers.get('location'), /e=state/);
  const r = await call('sf_session=eyJpZCI6IjEiLCJleHAiOjk5OTk5OTk5OTk5OTl9.faux', '/api/me');
  assert.equal((await r.json()).loggedIn, false);
});

test('joueur : jeu accessible, admin interdit', async () => {
  const c = await login('code-alice');
  const html = await (await call(c, '/')).text();
  assert.match(html, /id="orb"/);
  const me = await (await call(c, '/api/me')).json();
  assert.equal(me.user.role, 'player');
  assert.equal((await call(c, '/admin')).status, 403);
  assert.equal((await call(c, '/api/admin/overview')).status, 403);
  assert.equal((await call(c, '/api/me/progress', { name: 'Alice', level: 12, wins: 3, affinity: 'feu', form: 'shikai' })).status, 200);
});

test('fondateur : panel, rôles, bans, annonce, maintenance', async () => {
  const f = await login('code-founder');
  const alice = (await login('code-alice'));
  await login('code-bob');
  assert.equal((await (await call(f, '/api/me')).json()).user.role, 'founder');
  assert.equal((await call(f, '/admin')).status, 200);

  const ov = await (await call(f, '/api/admin/overview')).json();
  assert.equal(ov.counts.users, 3);
  assert.equal(ov.affinities.feu, 1);

  // Le fondateur est intouchable
  assert.equal((await call(f, '/api/admin/ban', { id: FOUNDER })).status, 403);

  // Nommer Bob admin, puis Bob (admin) ne peut pas gérer les rôles
  assert.equal((await call(f, '/api/admin/role', { id: '222222222222222222', role: 'admin' })).status, 200);
  const bob = await login('code-bob');
  assert.equal((await call(bob, '/api/admin/role', { id: '111111111111111111', role: 'admin' })).status, 403);
  assert.equal((await call(bob, '/api/admin/ban', { id: FOUNDER })).status, 403);
});

test('ban, annonce, maintenance', async () => {
  const f = await login('code-founder');
  const alice = await login('code-alice');

  assert.equal((await call(f, '/api/admin/ban', { id: '111111111111111111', reason: 'Test' })).status, 200);
  assert.match(await (await call(alice, '/')).text(), /Accès suspendu/);
  assert.equal((await call(alice, '/api/backup/status')).status, 403);
  assert.equal((await call(f, '/api/admin/unban', { id: '111111111111111111' })).status, 200);

  await call(f, '/api/admin/announce', { text: 'Bienvenue <b>à tous</b>', level: 'good' });
  const me = await (await call(alice, '/api/me')).json();
  assert.equal(me.announcement.level, 'good');
  assert.ok(!me.announcement.text.includes('<'));

  await call(f, '/api/admin/maintenance', { on: true, message: 'Retour à 20 h' });
  assert.match(await (await call(alice, '/')).text(), /Retour à 20 h/);
  assert.match(await (await call(f, '/')).text(), /id="orb"/); // l'équipe passe quand même
  await call(f, '/api/admin/maintenance', { on: false });

  const audit = await (await call(f, '/api/admin/audit')).json();
  assert.ok(audit.items.some((e) => e.action === 'ban'));
});

test('POST refusé depuis une autre origine', async () => {
  const f = await login('code-founder');
  const r = await fetch(`${base}/api/admin/announce`, {
    method: 'POST', headers: { cookie: f, 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ text: 'x' }),
  });
  assert.equal(r.status, 403);
});

test('sauvegardes de la base : créer, télécharger, restaurer, droits', async () => {
  const f = await login('code-founder');
  const alice = await login('code-alice');
  const bob = await login('code-bob'); // admin depuis le test précédent

  // Joueur : interdit. Admin : peut lister et créer, pas télécharger / restaurer / supprimer.
  assert.equal((await call(alice, '/api/admin/backups')).status, 403);
  assert.equal((await call(bob, '/api/admin/backups')).status, 200);
  const made = await (await call(bob, '/api/admin/backup/create', {})).json();
  assert.match(made.backup.name, /^db-\d{8}-\d{6}-manual/);
  assert.equal((await call(bob, `/api/admin/backup/get?name=${made.backup.name}`)).status, 403);
  assert.equal((await call(bob, '/api/admin/backup/restore', { name: made.backup.name })).status, 403);
  assert.equal((await call(bob, '/api/admin/backup/delete', { name: made.backup.name })).status, 403);

  // Fondateur : télécharge, change l'annonce, restaure et retrouve l'état d'avant.
  const doc = await (await call(f, `/api/admin/backup/get?name=${made.backup.name}`)).json();
  assert.equal(doc.format, 'soul-forge-db');
  await call(f, '/api/admin/announce', { text: 'Après la sauvegarde', level: 'info' });
  assert.equal((await call(f, '/api/admin/backup/restore', { name: made.backup.name })).status, 200);
  assert.ok(!/Après la sauvegarde/.test(JSON.stringify((await (await call(alice, '/api/me')).json()).announcement)), 'annonce revenue à l’état sauvegardé');
  const list = await (await call(f, '/api/admin/backups')).json();
  assert.ok(list.items.some((b) => b.kind === 'pre-restore'), 'instantané avant restauration');

  // Fichier envoyé : somme de contrôle vérifiée, base intacte si refusé.
  doc.data.users = {};
  assert.equal((await call(f, '/api/admin/backup/restore', { doc })).status, 400);
  assert.equal((await call(f, '/api/admin/backup/restore', { doc: { format: 'autre' } })).status, 400);
  assert.equal((await (await call(f, '/api/admin/overview')).json()).counts.users, 3);

  // Noms piégés refusés, suppression OK.
  assert.equal((await call(f, '/api/admin/backup/get?name=../db.json')).status, 400);
  assert.equal((await call(f, '/api/admin/backup/delete', { name: made.backup.name })).status, 200);
  assert.equal((await call(f, `/api/admin/backup/get?name=${made.backup.name}`)).status, 404);
});

test('cadeaux : donner, récupérer, acquitter, droits', async () => {
  const f = await login('code-founder');
  const alice = await login('code-alice');
  const bob = await login('code-bob'); // admin
  const A = '111111111111111111';

  // Joueur : interdit. Rien à donner : refusé.
  assert.equal((await call(alice, '/api/admin/give', { id: A, level: 5 })).status, 403);
  assert.equal((await call(f, '/api/admin/give', { id: A })).status, 400);

  // « Tout donner » : valeurs bornées côté serveur, Shikai + Bankai, affinité par défaut.
  assert.equal((await call(bob, '/api/admin/give', { id: A, preset: 'all', level: 9999 })).status, 200);
  let items = (await (await call(alice, '/api/me/grants')).json()).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].g.level, 100);
  assert.equal(items[0].g.bankai, true);
  assert.equal(items[0].g.shikai, true);
  assert.equal(items[0].g.upg.aura, 500);
  assert.equal(items[0].g.affinityIfNone, undefined, 'Alice a déjà une affinité : on ne la lui impose pas');

  // Joueur sans affinité connue : le Shikai/Bankai lui donne l'affinité Feu par défaut.
  assert.equal((await call(f, '/api/admin/give', { id: '222222222222222222', preset: 'all' })).status, 200);
  const bobItems = (await (await call(bob, '/api/me/grants')).json()).items;
  assert.equal(bobItems[0].g.affinityIfNone, 'feu');

  // Acquittement : la file se vide.
  assert.equal((await call(alice, '/api/me/grants', { ack: [items[0].id] })).status, 200);
  assert.equal((await (await call(alice, '/api/me/grants')).json()).items.length, 0);

  // Cadeau précis, joueur inconnu refusé, « tous » réservé au fondateur.
  assert.equal((await call(f, '/api/admin/give', { id: A, reiatsu: 500, affinity: 'glace', upg: { focus: 20 } })).status, 200);
  assert.equal((await call(f, '/api/admin/give', { id: '999999999999999999', level: 5 })).status, 404);
  assert.equal((await call(bob, '/api/admin/give', { id: 'all', level: 5 })).status, 403);
  const all = await (await call(f, '/api/admin/give', { id: 'all', level: 5 })).json();
  assert.ok(all.count >= 3);
  items = (await (await call(alice, '/api/me/grants')).json()).items;
  assert.equal(items.length, 2);
  assert.equal(items[0].g.affinity, 'glace');
  assert.equal(items[0].g.upg.focus, 20);

  const audit = await (await call(f, '/api/admin/audit')).json();
  assert.ok(audit.items.some((e) => e.action === 'give'));
  assert.ok(audit.items.some((e) => e.action === 'give-all'));
});
