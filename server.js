'use strict';
// Serveur sans dépendance : fichiers statiques + sauvegarde Discord (webhook).
// Node 18+ (fetch, FormData et Blob sont natifs).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { createStore } = require('./lib/store');
const { createAuth } = require('./lib/auth');
const { createBackups } = require('./lib/backups');
const { createAdminApi } = require('./lib/admin-api');

const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';
const ROOT = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data: https://cdn.discordapp.com", "connect-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '),
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/svg)/;
const files = new Map(); // cache mémoire : { buf, gz, etag } (désactivé hors production)

/* ═════════ Sauvegarde Discord ═════════
 * DISCORD_WEBHOOK_URL : webhook du salon qui sert de coffre (jamais exposé au navigateur).
 * Le joueur reçoit un code « SFD-<id du message>-<clé> ». Seul le hash de la clé est écrit
 * dans le message : avoir l'id du message ne suffit pas pour relire une sauvegarde.
 */
const GAME_ID = 'soul-forge';
const DISCORD_OVERRIDE = !!process.env.DISCORD_API_BASE; // uniquement pour les tests locaux
const DISCORD_API = (process.env.DISCORD_API_BASE || 'https://discord.com/api').replace(/\/+$/, '');
const MAX_BODY = 32 * 1024;   // taille max d'une requête
const MAX_SAVE = 20 * 1024;   // taille max d'une sauvegarde
const AFF_COLORS = { feu: 0xff6a3d, glace: 0x6fd3ff, foudre: 0xf5d34a, ombre: 0xa67bff, vent: 0x5be3a8 };
const AFF_LABELS = { feu: 'Feu', glace: 'Glace', foudre: 'Foudre', ombre: 'Ombre', vent: 'Vent' };
const FORM_LABELS = { scelle: 'Scellé', shikai: 'Shikai', bankai: 'Bankai' };

function parseWebhook(url) {
  if (!url) return null;
  const m = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d{5,25})\/([\w-]{20,120})\/?$/.exec(url.trim());
  return m ? { id: m[1], token: m[2] } : null;
}
const WEBHOOK = parseWebhook(process.env.DISCORD_WEBHOOK_URL);
if (process.env.DISCORD_WEBHOOK_URL && !WEBHOOK) {
  console.warn('DISCORD_WEBHOOK_URL est défini mais invalide : sauvegarde Discord désactivée.');
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);

// Limite de débit en mémoire (par IP et par action).
const hits = new Map();
function limited(req, bucket, max, windowMs, who) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = `${bucket}:${who || fwd || req.socket.remoteAddress}`;
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now);
  hits.set(key, arr);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) {
    const fresh = arr.filter((t) => now - t < 3600e3);
    if (fresh.length) hits.set(k, fresh); else hits.delete(k);
  }
}, 600e3).unref();

function sendJSON(res, status, obj) {
  res.writeHead(status, { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJSON(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('Requête trop volumineuse.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('JSON invalide.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const fail = (status, message) => Object.assign(new Error(message), { status });

/* ═════════ Comptes Discord, rôles, panel admin ═════════ */
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const store = createStore(DATA_DIR);
const auth = createAuth({ store, discordApi: DISCORD_API, security: SECURITY, limited });
const backups = createBackups({ store });
const adminApi = createAdminApi({ store, auth, backups, sendJSON, readJSON, fail, webhookEnabled: () => !!WEBHOOK });
const ADMIN_DIR = path.join(__dirname, 'admin');
const ADMIN_FILES = { '/admin': 'admin.html', '/admin/': 'admin.html', '/admin/admin.js': 'admin.js', '/admin/admin.css': 'admin.css' };

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function statusPage(title, text, withLogout) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} — Soul Forge</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head>
<body><div class="wrap" style="max-width:520px;padding-top:12vh"><section class="card" style="text-align:center"><h2>${esc(title)}</h2>
<p style="margin:0 0 18px">${esc(text)}</p>${withLogout ? '<form method="post" action="/auth/logout"><button class="btn" type="submit">Se déconnecter</button></form>' : ''}</section></div></body></html>`;
}
const sameOrigin = (req) => {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
};
const maintenanceOn = () => store.db.settings.maintenance && store.db.settings.maintenance.on;
const maintenanceText = () => store.db.settings.maintenance.message || 'Le jeu revient très vite.';

function meInfo(a) {
  if (a && Date.now() - (a.user.lastSeen || 0) > 60e3) { a.user.lastSeen = Date.now(); store.touch(); }
  return {
    authEnabled: auth.ENABLED,
    requireLogin: auth.REQUIRE_LOGIN,
    loggedIn: !!a,
    user: a ? { id: a.user.id, name: auth.displayName(a.user), avatar: auth.avatarUrl(a.user), role: a.role } : null,
    banned: a && a.user.banned ? { reason: a.user.banned.reason } : null,
    announcement: store.db.settings.announcement,
    maintenance: { on: !!maintenanceOn() && (!a || a.role === 'player'), message: maintenanceText() },
  };
}

// Ce que voit un visiteur sur « / » : page de connexion, suspension, maintenance ou le jeu.
function gateFor(req) {
  if (!auth.REQUIRE_LOGIN) return {};
  const a = auth.session(req);
  if (!a) return { login: true };
  if (a.user.banned) return { status: 403, page: statusPage('Accès suspendu', `Ton compte a été suspendu. Raison : ${a.user.banned.reason}`, true) };
  if (maintenanceOn() && a.role === 'player') return { status: 503, page: statusPage('Maintenance', maintenanceText(), true) };
  return {};
}

function serveAdmin(req, res, pathname) {
  const head = { ...SECURITY, 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' };
  if (!auth.ENABLED) {
    res.writeHead(503, head);
    return res.end(statusPage('Admin indisponible', 'La connexion Discord n’est pas configurée (DISCORD_CLIENT_ID et DISCORD_CLIENT_SECRET).'));
  }
  const a = auth.session(req);
  if (!a) return auth.redirect(res, '/auth/login?next=admin');
  if (a.user.banned || !auth.isStaff(a.role)) {
    res.writeHead(403, head);
    return res.end(statusPage('Accès réservé', 'Cette page est réservée à l’équipe d’administration.', false));
  }
  const name = ADMIN_FILES[pathname];
  if (!name) { res.writeHead(404, { ...head, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable.'); }
  fs.readFile(path.join(ADMIN_DIR, name), (err, buf) => {
    if (err) { res.writeHead(404, { ...head, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable.'); }
    res.writeHead(200, { ...head, 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream' });
    res.end(buf);
  });
}

async function discordBackup(body) {
  if (!body || body.game !== GAME_ID || !body.data || typeof body.data !== 'object' || typeof body.checksum !== 'string') {
    throw fail(400, 'Sauvegarde non reconnue.');
  }
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > MAX_SAVE) throw fail(413, 'Sauvegarde trop volumineuse.');

  const d = body.data;
  const name = String(d.name || 'Shinigami').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 20) || 'Shinigami';
  const level = Math.floor(Math.min(100, Math.max(1, Number(d.level) || 1)));
  const wins = Math.floor(Math.min(1e9, Math.max(0, Number(d.wins) || 0)));
  const aff = typeof d.affinity === 'string' && Object.prototype.hasOwnProperty.call(AFF_LABELS, d.affinity) ? d.affinity : null;
  const form = typeof d.form === 'string' && Object.prototype.hasOwnProperty.call(FORM_LABELS, d.form) ? d.form : 'scelle';
  const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ame';
  const filename = `soul-forge-${slug}-niv${level}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;

  const secret = crypto.randomBytes(8).toString('hex');
  const payload = {
    username: 'Soul Forge',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `Sauvegarde · ${name}`,
      description: 'Pour restaurer : colle le code reçu dans le jeu, ou télécharge le fichier joint puis « Charger un fichier ».',
      color: aff ? AFF_COLORS[aff] : 0x8c78ff,
      fields: [
        { name: 'Niveau', value: String(level), inline: true },
        { name: 'Affinité', value: aff ? AFF_LABELS[aff] : '—', inline: true },
        { name: 'Forme', value: FORM_LABELS[form], inline: true },
        { name: 'Victoires', value: String(wins), inline: true },
      ],
      footer: { text: `ref:${sha(secret)}` },
      timestamp: new Date().toISOString(),
    }],
    attachments: [{ id: 0, filename }],
  };

  const fd = new FormData();
  fd.append('payload_json', JSON.stringify(payload));
  fd.append('files[0]', new Blob([text], { type: 'application/json' }), filename);

  let r;
  try {
    r = await fetch(`${DISCORD_API}/webhooks/${WEBHOOK.id}/${WEBHOOK.token}?wait=true`, {
      method: 'POST', body: fd, signal: AbortSignal.timeout(15000),
    });
  } catch { throw fail(502, 'Discord est injoignable pour le moment.'); }
  if (r.status === 429) throw fail(503, 'Discord est saturé, réessaie dans un instant.');
  if (!r.ok) throw fail(502, 'Discord a refusé la sauvegarde.');
  const msg = await r.json().catch(() => null);
  if (!msg || !/^\d{5,25}$/.test(String(msg.id))) throw fail(502, 'Réponse Discord inattendue.');
  store.db.stats.backups++; store.touch();
  return { code: `SFD-${msg.id}-${secret}` };
}

async function discordRestore(body) {
  const m = /^SFD-(\d{5,25})-([0-9a-f]{16})$/.exec(String((body && body.code) || '').trim());
  if (!m) throw fail(400, 'Code Discord invalide (format SFD-…).');
  const [, msgId, secret] = m;
  const notFound = fail(404, 'Sauvegarde introuvable (code erroné ou message supprimé).');

  let r;
  try {
    r = await fetch(`${DISCORD_API}/webhooks/${WEBHOOK.id}/${WEBHOOK.token}/messages/${msgId}`, { signal: AbortSignal.timeout(15000) });
  } catch { throw fail(502, 'Discord est injoignable pour le moment.'); }
  if (r.status === 404) throw notFound;
  if (r.status === 429) throw fail(503, 'Discord est saturé, réessaie dans un instant.');
  if (!r.ok) throw fail(502, 'Discord a refusé la lecture.');
  const msg = await r.json().catch(() => null);

  const ref = msg && msg.embeds && msg.embeds[0] && msg.embeds[0].footer && msg.embeds[0].footer.text;
  if (ref !== `ref:${sha(secret)}`) throw notFound; // clé fausse : même réponse qu'un message absent
  const att = msg.attachments && msg.attachments[0];
  if (!att || typeof att.url !== 'string') throw notFound;

  let url;
  try { url = new URL(att.url); } catch { throw fail(502, 'Pièce jointe illisible.'); }
  const okHost = DISCORD_OVERRIDE || (url.protocol === 'https:' && /^(cdn\.discordapp\.com|media\.discordapp\.net)$/.test(url.hostname));
  if (!okHost) throw fail(502, 'Pièce jointe illisible.');

  let f;
  try { f = await fetch(url, { signal: AbortSignal.timeout(15000) }); }
  catch { throw fail(502, 'Discord est injoignable pour le moment.'); }
  if (!f.ok) throw fail(502, 'Pièce jointe indisponible.');
  const len = Number(f.headers.get('content-length') || 0);
  if (len > MAX_SAVE) throw fail(502, 'Pièce jointe trop volumineuse.');
  const buf = Buffer.from(await f.arrayBuffer());
  if (buf.length > MAX_SAVE) throw fail(502, 'Pièce jointe trop volumineuse.');
  let backup;
  try { backup = JSON.parse(buf.toString('utf8')); } catch { throw fail(502, 'Sauvegarde abîmée sur Discord.'); }
  if (!backup || backup.game !== GAME_ID) throw fail(502, 'Sauvegarde abîmée sur Discord.');
  store.db.stats.restores++; store.touch();
  return { backup };
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === 'POST' && !sameOrigin(req)) return sendJSON(res, 403, { error: 'Origine refusée.' });
    const a = auth.session(req);

    if (pathname === '/api/me' && req.method === 'GET') return sendJSON(res, 200, meInfo(a));

    if (pathname.startsWith('/api/admin/')) {
      if (!a) return sendJSON(res, 401, { error: 'Connexion requise.' });
      if (a.user.banned || !auth.isStaff(a.role)) return sendJSON(res, 403, { error: 'Accès réservé à l’équipe.' });
      return await adminApi.handle(req, res, pathname, a);
    }

    if (auth.REQUIRE_LOGIN) {
      if (!a) return sendJSON(res, 401, { error: 'Connexion Discord requise.', login: true });
      if (a.user.banned) return sendJSON(res, 403, { error: 'Ton compte est suspendu.', banned: true });
      if (maintenanceOn() && a.role === 'player') return sendJSON(res, 503, { error: 'Maintenance en cours.' });
    }

    // Cadeaux de l'équipe (panel admin) : le jeu les récupère, les applique, puis les acquitte.
    if (pathname === '/api/me/grants') {
      if (!a) return sendJSON(res, 200, { items: [] });
      if (req.method === 'GET') {
        return sendJSON(res, 200, { items: (a.user.grants || []).map((x) => ({ id: x.id, g: x.g })) });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return sendJSON(res, 405, { error: 'Méthode non autorisée.' }); }
      const b = await readJSON(req);
      const ids = new Set(Array.isArray(b.ack) ? b.ack.map(String).slice(0, 50) : []);
      if (a.user.grants) { a.user.grants = a.user.grants.filter((x) => !ids.has(x.id)); store.touch(); }
      return sendJSON(res, 200, { ok: true });
    }

    // Résumé de progression envoyé par le jeu (affichage dans le panel, pas anti-triche).
    if (pathname === '/api/me/progress') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJSON(res, 405, { error: 'Méthode non autorisée.' }); }
      if (!a) return sendJSON(res, 401, { error: 'Connexion requise.' });
      if (limited(req, 'progress', 40, 10 * 60e3, a.user.id)) return sendJSON(res, 429, { error: 'Trop de requêtes.' });
      const b = await readJSON(req);
      const clamp = (v, lo, hi) => Math.floor(Math.min(hi, Math.max(lo, Number(v) || 0)));
      a.user.progress = {
        name: String(b.name || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 20) || 'Shinigami',
        level: clamp(b.level, 1, 100),
        wins: clamp(b.wins, 0, 1e9),
        affinity: Object.prototype.hasOwnProperty.call(AFF_LABELS, b.affinity) ? b.affinity : null,
        form: Object.prototype.hasOwnProperty.call(FORM_LABELS, b.form) ? b.form : 'scelle',
        updated: Date.now(),
      };
      store.touch();
      return sendJSON(res, 200, { ok: true });
    }

    if (pathname === '/api/backup/status' && req.method === 'GET') {
      return sendJSON(res, 200, { enabled: !!WEBHOOK });
    }
    if (pathname !== '/api/backup' && pathname !== '/api/backup/restore') return sendJSON(res, 404, { error: 'Introuvable.' });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendJSON(res, 405, { error: 'Méthode non autorisée.' }); }
    if (!WEBHOOK) return sendJSON(res, 503, { error: 'La sauvegarde Discord n’est pas configurée sur ce serveur.' });

    const send = pathname === '/api/backup';
    if (limited(req, send ? 'send' : 'restore', send ? 6 : 20, 10 * 60e3, a && a.user.id)) {
      return sendJSON(res, 429, { error: 'Trop de tentatives, patiente quelques minutes.' });
    }
    const body = await readJSON(req);
    return sendJSON(res, 200, send ? await discordBackup(body) : await discordRestore(body));
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error('Erreur API :', e);
    return sendJSON(res, status, { error: status === 500 ? 'Erreur interne.' : e.message });
  }
}

/* ═════════ Serveur ═════════ */
const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, SECURITY);
    return res.end('Bad request');
  }

  if (pathname === '/health') {
    res.writeHead(200, { ...SECURITY, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
  }

  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  if (pathname.startsWith('/auth/')) return auth.handle(req, res, pathname).catch(() => { res.writeHead(500, SECURITY); res.end('Erreur'); });
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return serveAdmin(req, res, pathname);

  if (pathname === '/' || pathname === '/index.html') {
    const gate = gateFor(req);
    if (gate.page) {
      res.writeHead(gate.status, { ...SECURITY, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(gate.page);
    }
    pathname = gate.login ? '/login.html' : '/index.html';
  }

  if (pathname === '/') pathname = '/index.html';

  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, SECURITY);
    return res.end('Forbidden');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...SECURITY, Allow: 'GET, HEAD' });
    return res.end();
  }

  const serve = (entry) => {
    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    const headers = {
      ...SECURITY, 'Content-Type': type, ETag: entry.etag, Vary: 'Accept-Encoding, Cookie',
      'Cache-Control': ext === '.html' ? 'no-cache' : /^\.(png|svg|ico|webmanifest)$/.test(ext) ? 'public, max-age=86400' : 'public, max-age=3600, must-revalidate',
    };
    if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); return res.end(); }
    if (ext === '.html') { // URLs absolues pour l'aperçu de partage (Discord, X, WhatsApp…)
      const host = /^[\w.-]+(:\d+)?$/.test(req.headers.host || '') ? req.headers.host : 'localhost';
      const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const html = Buffer.from(entry.buf.toString('utf8').replace(/__ORIGIN__/g, `${proto}://${host}`));
      headers['Content-Length'] = html.length;
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    const gz = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = gz ? entry.gz : entry.buf;
    if (gz) headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  const hit = PROD && files.get(file);
  if (hit) return serve(hit);
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - Cette âme est introuvable.');
    }
    const type = TYPES[path.extname(file).toLowerCase()] || '';
    const entry = {
      buf, etag: `"${crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20)}"`,
      gz: COMPRESSIBLE.test(type) && buf.length > 512 ? zlib.gzipSync(buf, { level: 9 }) : null,
    };
    if (PROD) files.set(file, entry);
    serve(entry);
  });
});

if (require.main === module) {
  backups.startAuto();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Soul Forge en ligne sur le port ${PORT} · sauvegarde Discord ${WEBHOOK ? 'activée' : 'désactivée'}`);
    console.log(auth.ENABLED
      ? `Connexion Discord activée (${auth.REQUIRE_LOGIN ? 'obligatoire' : 'facultative'}) · fondateur ${auth.FOUNDER_ID} · données : ${DATA_DIR}`
      : 'Connexion Discord désactivée : définis DISCORD_CLIENT_ID et DISCORD_CLIENT_SECRET pour l’activer.');
    if (auth.ENABLED && !process.env.SESSION_SECRET) console.warn('SESSION_SECRET absent : secret dérivé de DISCORD_CLIENT_SECRET (OK, mais mieux vaut le définir).');
  });
  // Railway envoie SIGTERM à chaque redéploiement : on termine proprement les requêtes en cours.
  const stop = () => {
    store.flush();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = server;
