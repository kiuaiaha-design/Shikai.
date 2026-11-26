'use strict';
// API du panel admin (réservée au fondateur et aux admins).
// Fondateur : tout, dont nommer / retirer des admins et télécharger / restaurer / supprimer les sauvegardes.
// Admin : joueurs, annonce, maintenance, liste et création de sauvegardes.
const crypto = require('crypto');

function createAdminApi({ store, auth, backups, sendJSON, readJSON, fail, webhookEnabled }) {
  const db = () => store.db;
  const PAGE = 20;
  const LEVELS = ['info', 'good', 'warn'];
  const AFFS = ['feu', 'glace', 'foudre', 'ombre', 'vent'];
  const UPGS = ['focus', 'aura', 'discipline'];
  const MAX_PENDING = 20;
  const clampInt = (v, lo, hi) => Math.floor(Math.min(hi, Math.max(lo, Number(v) || 0)));

  // Nettoie un cadeau demandé par le panel. Le jeu l'applique à la prochaine synchro du joueur.
  function cleanGrant(b) {
    const g = {};
    if (b.preset === 'all') { // « Tout donner » : niveau max, Shikai, Bankai, tout au maximum
      Object.assign(g, { level: 100, reiatsu: 1e12, wins: 100, shikai: true, bankai: true, form: 'bankai', upg: { focus: 500, aura: 500, discipline: 500 } });
    }
    const n = (v, hi) => clampInt(v, 0, hi);
    if (b.level) g.level = clampInt(b.level, 1, 100);
    if (b.xp) g.xp = n(b.xp, 1e9);
    if (b.reiatsu) g.reiatsu = n(b.reiatsu, 1e14);
    if (b.wins) g.wins = n(b.wins, 1e6);
    if (b.shikai) g.shikai = true;
    if (b.bankai) g.bankai = true;
    if (AFFS.includes(b.affinity)) g.affinity = b.affinity;
    if (['shikai', 'bankai'].includes(b.form)) g.form = b.form;
    if (b.upg && typeof b.upg === 'object') {
      g.upg = g.upg || {};
      for (const k of UPGS) { const v = n(b.upg[k], 500); if (v) g.upg[k] = Math.max(g.upg[k] || 0, v); }
      if (!Object.keys(g.upg).length) delete g.upg;
    }
    if (g.bankai) g.shikai = true;
    return Object.keys(g).length ? g : null;
  }
  const describeGrant = (g) => [
    g.level && `niv. ${g.level}`, g.xp && `+${g.xp} xp`, g.reiatsu && `+${g.reiatsu} reiatsu`, g.wins && `+${g.wins} victoires`,
    g.affinity && `affinité ${g.affinity}`, g.shikai && 'Shikai', g.bankai && 'Bankai',
    g.upg && `améliorations ${Object.entries(g.upg).map(([k, v]) => `${k} ${v}`).join('/')}`,
  ].filter(Boolean).join(', ');

  const view = (u) => ({
    id: u.id,
    name: auth.displayName(u),
    username: u.username || null,
    avatar: auth.avatarUrl(u),
    role: auth.roleOf(u.id),
    banned: u.banned || null,
    pending: !!u.stub,
    firstSeen: u.firstSeen || null,
    lastSeen: u.lastSeen || null,
    logins: u.logins || 0,
    progress: u.progress || null,
    pendingGrants: Array.isArray(u.grants) ? u.grants.length : 0,
  });
  const nameOf = (id) => (db().users[id] ? auth.displayName(db().users[id]) : id);

  function overview() {
    const now = Date.now();
    const all = Object.values(db().users).filter((u) => !u.stub);
    const aff = { feu: 0, glace: 0, foudre: 0, ombre: 0, vent: 0 };
    let lvSum = 0, lvN = 0;
    for (const u of all) {
      const p = u.progress;
      if (!p) continue;
      lvSum += p.level; lvN++;
      if (p.affinity && aff[p.affinity] !== undefined) aff[p.affinity]++;
    }
    const top = all.filter((u) => u.progress).sort((a, b) => b.progress.level - a.progress.level || b.progress.wins - a.progress.wins).slice(0, 5);
    const mem = process.memoryUsage();
    return {
      counts: {
        users: all.length,
        admins: all.filter((u) => auth.isStaff(auth.roleOf(u.id))).length,
        banned: all.filter((u) => u.banned).length,
        active24h: all.filter((u) => now - (u.lastSeen || 0) < 864e5).length,
        active7d: all.filter((u) => now - (u.lastSeen || 0) < 6048e5).length,
        new24h: all.filter((u) => now - (u.firstSeen || 0) < 864e5).length,
        avgLevel: lvN ? Math.round((lvSum / lvN) * 10) / 10 : 0,
      },
      stats: db().stats,
      affinities: aff,
      top: top.map(view),
      server: {
        uptime: process.uptime(), rssMb: Math.round(mem.rss / 1048576), node: process.version,
        persistent: store.persistent, discordBackup: webhookEnabled(), requireLogin: auth.REQUIRE_LOGIN,
      },
      settings: db().settings,
      backups: (() => { const l = backups.list(); return { count: l.length, last: l[0] ? l[0].at : null }; })(),
    };
  }

  const founderOnly = (actor) => { if (actor.role !== 'founder') throw fail(403, 'Réservé au fondateur.'); };
  const MAX_RESTORE = 10 * 1024 * 1024;

  function users(q) {
    const term = String(q.get('q') || '').toLowerCase().trim().slice(0, 40);
    const filter = q.get('filter') || 'all';
    const sort = q.get('sort') || 'recent';
    let list = Object.values(db().users).filter((u) => {
      if (term && !`${u.id} ${u.username || ''} ${u.globalName || ''}`.toLowerCase().includes(term)) return false;
      if (filter === 'banned') return !!u.banned;
      if (filter === 'staff') return auth.isStaff(auth.roleOf(u.id));
      return true;
    });
    const lv = (u) => (u.progress ? u.progress.level : 0);
    list.sort(sort === 'level' ? (a, b) => lv(b) - lv(a)
      : sort === 'new' ? (a, b) => (b.firstSeen || 0) - (a.firstSeen || 0)
      : (a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    const page = Math.max(1, parseInt(q.get('page'), 10) || 1);
    return { total: list.length, page, pages: Math.max(1, Math.ceil(list.length / PAGE)), items: list.slice((page - 1) * PAGE, page * PAGE).map(view) };
  }

  function target(body) {
    const id = String((body && body.id) || '');
    if (!auth.ID_RE.test(id)) throw fail(400, 'Identifiant Discord invalide.');
    return id;
  }

  async function handle(req, res, pathname, actor) {
    const me = actor.user.id;
    const key = `${req.method} ${pathname}`;
    const url = new URL(req.url, 'http://localhost');

    if (key === 'GET /api/admin/overview') return sendJSON(res, 200, { me: view(actor.user), ...overview() });
    if (key === 'GET /api/admin/users') return sendJSON(res, 200, users(url.searchParams));
    if (key === 'GET /api/admin/audit') {
      const items = db().audit.slice(-100).reverse().map((e) => ({
        t: e.t, action: e.action, detail: e.detail, actor: nameOf(e.actor), target: e.target ? nameOf(e.target) : null,
      }));
      return sendJSON(res, 200, { items });
    }
    if (key === 'GET /api/admin/backups') return sendJSON(res, 200, { items: backups.list(), persistent: store.persistent, keep: 'auto : 7 · manuelles : 20' });
    if (key === 'GET /api/admin/backup/get') { // téléchargement : le fondateur seul (la base contient tous les joueurs)
      founderOnly(actor);
      return sendJSON(res, 200, backups.read(url.searchParams.get('name')));
    }
    if (req.method !== 'POST') return sendJSON(res, 404, { error: 'Introuvable.' });
    const body = await readJSON(req, pathname === '/api/admin/backup/restore' ? MAX_RESTORE : undefined);

    if (pathname === '/api/admin/backup/create') {
      const b = backups.create('manual', me);
      store.audit(me, 'backup-create', null, b.name);
      return sendJSON(res, 200, { backup: b });
    }

    if (pathname === '/api/admin/backup/delete') {
      founderOnly(actor);
      backups.remove(body.name);
      store.audit(me, 'backup-delete', null, String(body.name));
      return sendJSON(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/backup/restore') {
      founderOnly(actor);
      // Soit une sauvegarde du serveur (name), soit un fichier envoyé (doc).
      const doc = body.name ? backups.read(body.name) : body.doc;
      const r = backups.restore(doc, me);
      store.audit(me, 'backup-restore', null, body.name ? String(body.name) : 'fichier envoyé');
      return sendJSON(res, 200, r);
    }

    if (pathname === '/api/admin/give') {
      const g = cleanGrant(body);
      if (!g) throw fail(400, 'Rien à donner : remplis au moins un champ.');
      const push = (u) => {
        const list = Array.isArray(u.grants) ? u.grants : (u.grants = []);
        list.push({ id: crypto.randomBytes(6).toString('hex'), at: Date.now(), by: me, g });
        if (list.length > MAX_PENDING) list.splice(0, list.length - MAX_PENDING);
        if (!u.stub && !g.affinity && (g.shikai || g.bankai) && !(u.progress && u.progress.affinity)) list[list.length - 1] = { ...list[list.length - 1], g: { ...g, affinityIfNone: 'feu' } };
      };
      if (body.id === 'all') { // tous les joueurs : fondateur uniquement
        founderOnly(actor);
        const targets = Object.values(db().users).filter((u) => !u.stub && !u.banned);
        targets.forEach(push);
        store.audit(me, 'give-all', null, `${targets.length} joueurs : ${describeGrant(g)}`);
        return sendJSON(res, 200, { count: targets.length });
      }
      const id = target(body);
      const u = db().users[id];
      if (!u) throw fail(404, 'Joueur introuvable.');
      push(u);
      store.audit(me, 'give', id, describeGrant(g));
      return sendJSON(res, 200, { user: view(u), count: 1 });
    }

    if (pathname === '/api/admin/ban') {
      const id = target(body);
      const u = db().users[id];
      if (!u || u.stub) throw fail(404, 'Joueur introuvable.');
      if (id === auth.FOUNDER_ID) throw fail(403, 'Le fondateur est intouchable.');
      if (id === me) throw fail(400, 'Tu ne peux pas te bannir toi-même.');
      if (auth.roleOf(id) === 'admin' && actor.role !== 'founder') throw fail(403, 'Seul le fondateur peut bannir un admin.');
      const reason = auth.clip(body.reason, 200) || 'Aucune raison précisée.';
      u.banned = { reason, at: Date.now(), by: me };
      store.audit(me, 'ban', id, reason);
      return sendJSON(res, 200, { user: view(u) });
    }

    if (pathname === '/api/admin/unban') {
      const id = target(body);
      const u = db().users[id];
      if (!u || !u.banned) throw fail(404, 'Ce joueur n’est pas banni.');
      delete u.banned;
      store.audit(me, 'unban', id);
      return sendJSON(res, 200, { user: view(u) });
    }

    if (pathname === '/api/admin/role') {
      if (actor.role !== 'founder') throw fail(403, 'Seul le fondateur gère les admins.');
      const id = target(body);
      if (id === auth.FOUNDER_ID) throw fail(400, 'Le fondateur a déjà tous les droits.');
      if (body.role !== 'admin' && body.role !== 'player') throw fail(400, 'Rôle invalide.');
      let u = db().users[id];
      if (!u) {
        if (body.role === 'player') throw fail(404, 'Joueur introuvable.');
        u = db().users[id] = { id, stub: true, firstSeen: Date.now(), logins: 0 }; // pré-autorisé avant sa 1re connexion
      }
      if (body.role === 'admin') u.role = 'admin'; else delete u.role;
      store.audit(me, body.role === 'admin' ? 'promote' : 'demote', id);
      return sendJSON(res, 200, { user: view(u) });
    }

    if (pathname === '/api/admin/announce') {
      const text = auth.clip(body.text, 280);
      if (!text) {
        db().settings.announcement = null;
        store.audit(me, 'announce-clear');
        return sendJSON(res, 200, { announcement: null });
      }
      const level = LEVELS.includes(body.level) ? body.level : 'info';
      db().settings.announcement = { id: crypto.randomBytes(6).toString('hex'), text, level, at: Date.now(), by: me };
      store.audit(me, 'announce', null, text);
      return sendJSON(res, 200, { announcement: db().settings.announcement });
    }

    if (pathname === '/api/admin/maintenance') {
      const on = !!body.on;
      db().settings.maintenance = { on, message: auth.clip(body.message, 200) };
      store.audit(me, on ? 'maintenance-on' : 'maintenance-off', null, db().settings.maintenance.message);
      return sendJSON(res, 200, { maintenance: db().settings.maintenance });
    }

    return sendJSON(res, 404, { error: 'Introuvable.' });
  }

  return { handle };
}

module.exports = { createAdminApi };
