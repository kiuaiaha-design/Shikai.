'use strict';
// Connexion Discord (OAuth2, scope « identify »), sessions signées et rôles.
const crypto = require('crypto');

const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('base64url');
const ID_RE = /^\d{15,25}$/;
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);

function createAuth({ store, discordApi, security, limited }) {
  const FOUNDER_ID = (process.env.FOUNDER_ID || '653263485362503693').trim();
  const CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '').trim();
  const CLIENT_SECRET = (process.env.DISCORD_CLIENT_SECRET || '').trim();
  const ENABLED = !!(CLIENT_ID && CLIENT_SECRET);
  const REQUIRE_LOGIN = ENABLED && process.env.REQUIRE_LOGIN !== 'false';
  const BASE_URL = (process.env.BASE_URL || '').trim().replace(/\/+$/, '');
  const SECRET = process.env.SESSION_SECRET
    || (ENABLED ? hmac(CLIENT_SECRET, 'soul-forge/session') : crypto.randomBytes(32).toString('hex'));
  const TTL = 30 * 86400e3;

  /* ── Rôles ── */
  const roleOf = (id) => {
    if (id === FOUNDER_ID) return 'founder';
    const u = store.db.users[id];
    return u && u.role === 'admin' ? 'admin' : 'player';
  };
  const isStaff = (role) => role === 'founder' || role === 'admin';

  const avatarUrl = (u) => {
    if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`;
    let i = 0;
    try { i = Number((BigInt(u.id) >> 22n) % 6n); } catch { /* id invalide */ }
    return `https://cdn.discordapp.com/embed/avatars/${i}.png`;
  };
  const displayName = (u) => u.globalName || u.username || u.id;

  /* ── Cookies & sessions ── */
  function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }
  const proto = (req) => (BASE_URL ? BASE_URL.split(':')[0] : req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http');
  function origin(req) {
    if (BASE_URL) return BASE_URL;
    const host = /^[\w.-]+(:\d+)?$/.test(req.headers.host || '') ? req.headers.host : 'localhost';
    return `${proto(req)}://${host}`;
  }
  const cookie = (req, name, value, maxAgeSec) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${proto(req) === 'https' ? '; Secure' : ''}`;

  function sign(obj) {
    const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
    return `${p}.${hmac(SECRET, p)}`;
  }
  function verify(token) {
    const [p, sig] = String(token || '').split('.');
    if (!p || !sig) return null;
    const good = Buffer.from(hmac(SECRET, p));
    const got = Buffer.from(sig);
    if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
    try {
      const o = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
      return o && typeof o.id === 'string' && o.exp > Date.now() ? o : null;
    } catch { return null; }
  }
  // → { user, role } ou null
  function session(req) {
    if (!ENABLED) return null;
    const o = verify(cookies(req).sf_session);
    const user = o && store.db.users[o.id];
    if (!user || user.stub) return null;
    return { user, role: roleOf(user.id) };
  }

  /* ── OAuth2 ── */
  function upsert(p) {
    const now = Date.now();
    const users = store.db.users;
    let u = users[p.id];
    if (!u) u = users[p.id] = { id: p.id, firstSeen: now, logins: 0 };
    if (u.stub) { delete u.stub; u.firstSeen = now; }
    u.username = clip(p.username, 40);
    u.globalName = clip(p.global_name, 40) || null;
    u.avatar = typeof p.avatar === 'string' && /^(a_)?[0-9a-f]{32}$/.test(p.avatar) ? p.avatar : null;
    u.lastSeen = now;
    u.logins = (u.logins || 0) + 1;
    store.db.stats.logins++;
    store.touch();
    return u;
  }

  async function fetchProfile(code, redirectUri) {
    const t = await fetch(`${discordApi}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!t.ok) throw new Error('token');
    const tok = await t.json();
    if (!tok || typeof tok.access_token !== 'string') throw new Error('token');
    const r = await fetch(`${discordApi}/users/@me`, {
      headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error('profile');
    const p = await r.json();
    if (!p || !ID_RE.test(String(p.id))) throw new Error('profile');
    return p;
  }

  function redirect(res, location, setCookies) {
    const h = { ...security, Location: location, 'Cache-Control': 'no-store' };
    if (setCookies) h['Set-Cookie'] = setCookies;
    res.writeHead(303, h);
    res.end();
  }

  async function handle(req, res, pathname) {
    if (!ENABLED) return redirect(res, '/');
    const url = new URL(req.url, 'http://localhost');

    if (pathname === '/auth/login' && req.method === 'GET') {
      if (limited(req, 'login', 30, 10 * 60e3)) return redirect(res, '/?e=rate');
      const state = crypto.randomBytes(16).toString('hex');
      const next = url.searchParams.get('next') === 'admin' ? 'a' : 'g';
      const q = new URLSearchParams({
        client_id: CLIENT_ID, response_type: 'code', scope: 'identify', prompt: 'none',
        redirect_uri: `${origin(req)}/auth/callback`, state,
      });
      return redirect(res, `https://discord.com/oauth2/authorize?${q}`, cookie(req, 'sf_state', `${state}.${next}`, 600));
    }

    if (pathname === '/auth/callback' && req.method === 'GET') {
      const clearState = cookie(req, 'sf_state', '', 0);
      const [st, next] = String(cookies(req).sf_state || '').split('.');
      if (url.searchParams.get('error')) return redirect(res, '/?e=denied', clearState);
      const code = url.searchParams.get('code');
      if (!st || !code || st !== url.searchParams.get('state')) return redirect(res, '/?e=state', clearState);
      if (limited(req, 'callback', 30, 10 * 60e3)) return redirect(res, '/?e=rate', clearState);
      let profile;
      try { profile = await fetchProfile(code, `${origin(req)}/auth/callback`); }
      catch { return redirect(res, '/?e=discord', clearState); }
      const user = upsert(profile);
      const token = sign({ id: user.id, exp: Date.now() + TTL });
      const dest = next === 'a' && isStaff(roleOf(user.id)) ? '/admin' : '/';
      return redirect(res, dest, [clearState, cookie(req, 'sf_session', token, TTL / 1000)]);
    }

    if (pathname === '/auth/logout' && req.method === 'POST') {
      return redirect(res, '/', cookie(req, 'sf_session', '', 0));
    }

    res.writeHead(404, { ...security, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Introuvable.');
  }

  return {
    ENABLED, REQUIRE_LOGIN, FOUNDER_ID, ID_RE, clip, origin, roleOf, isStaff, avatarUrl, displayName,
    session, handle, redirect,
  };
}

module.exports = { createAuth };
