'use strict';
// Session Discord côté jeu : puce utilisateur, annonce de l'équipe, résumé de progression.
(() => {
  const SAVE_KEY = 'soulforge.save.v1';
  const DISMISS_KEY = 'soulforge.announce.dismissed';
  const $ = (s) => document.querySelector(s);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else el.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) el.append(kid);
    return el;
  }

  async function getMe() {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  function chip(me) {
    const top = $('.top');
    if (!top || $('#userChip')) return;
    const logout = h('form', { method: 'post', action: '/auth/logout' }, h('button', { class: 'btn small', type: 'submit', text: 'Déconnexion' }));
    const box = h('div', { class: 'user-chip', id: 'userChip' },
      h('img', { src: me.user.avatar, alt: '', width: '28', height: '28', referrerpolicy: 'no-referrer' }),
      h('span', { class: 'user-name', text: me.user.name }),
      me.user.role !== 'player' ? h('a', { class: 'btn small primary', href: '/admin', text: 'Admin' }) : null,
      logout);
    top.append(box);
  }

  function banner(a) {
    const old = $('#announce');
    if (old) old.remove();
    let dismissed = null;
    try { dismissed = localStorage.getItem(DISMISS_KEY); } catch { /* ignore */ }
    if (!a || a.id === dismissed) return;
    const close = h('button', { class: 'announce-x', type: 'button', 'aria-label': 'Fermer', text: '×' });
    const el = h('div', { class: `announce ${a.level || 'info'}`, id: 'announce', role: 'status' }, h('span', { text: a.text }), close);
    close.addEventListener('click', () => {
      try { localStorage.setItem(DISMISS_KEY, a.id); } catch { /* ignore */ }
      el.remove();
    });
    document.body.prepend(el);
  }

  let lastSent = '';
  function report() {
    let s;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return; }
    if (!s || typeof s !== 'object') return;
    const body = JSON.stringify({ name: s.name, level: s.level, wins: s.wins, affinity: s.affinity, form: s.form });
    if (body === lastSent) return;
    lastSent = body;
    fetch('/api/me/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'same-origin', keepalive: true }).catch(() => { lastSent = ''; });
  }

  // Cadeaux de l'équipe : récupérés, appliqués par le jeu, puis acquittés (jamais appliqués deux fois).
  const DONE_KEY = 'soulforge.grants.done';
  async function claimGrants() {
    if (typeof window.__sfApplyGrants !== 'function') return;
    let items;
    try {
      const r = await fetch('/api/me/grants', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      items = (await r.json()).items;
    } catch { return; }
    if (!Array.isArray(items) || !items.length) return;
    let done = [];
    try { done = JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); } catch { /* ignore */ }
    if (!Array.isArray(done)) done = [];
    const fresh = items.filter((x) => !done.includes(x.id));
    const applied = fresh.length ? window.__sfApplyGrants(fresh) : [];
    try { localStorage.setItem(DONE_KEY, JSON.stringify(done.concat(applied).slice(-60))); } catch { /* ignore */ }
    fetch('/api/me/grants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ack: items.map((x) => x.id) }), credentials: 'same-origin' }).catch(() => {});
  }

  async function tick(first) {
    const me = await getMe();
    if (!me || !me.authEnabled) return;
    // Pas connecté, banni ou en maintenance : « / » affiche la bonne page.
    if (me.requireLogin && (!me.loggedIn || me.banned || me.maintenance.on)) { location.replace('/'); return; }
    if (!me.loggedIn) return;
    if (first) chip(me);
    banner(me.announcement);
    await claimGrants();
    report();
  }

  tick(true);
  setInterval(() => { if (!document.hidden) tick(false); }, 60000);
})();
