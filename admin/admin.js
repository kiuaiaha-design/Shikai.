'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const view = $('#view');
  let ME = null;

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const ROLE = { founder: 'Fondateur', admin: 'Admin', player: 'Joueur' };
  const AFF = { feu: 'Feu', glace: 'Glace', foudre: 'Foudre', ombre: 'Ombre', vent: 'Vent' };
  const AFF_COLOR = { feu: '#ff6a3d', glace: '#6fd3ff', foudre: '#f5d34a', ombre: '#a67bff', vent: '#5be3a8' };
  const FORM = { scelle: 'Scellé', shikai: 'Shikai', bankai: 'Bankai' };
  const ACTIONS = {
    give: 'a fait un cadeau à', 'give-all': 'a fait un cadeau à tous les joueurs',
    ban: 'a banni', unban: 'a débanni', promote: 'a nommé admin', demote: 'a retiré les droits admin de',
    announce: 'a publié une annonce', 'announce-clear': 'a retiré l’annonce',
    'maintenance-on': 'a activé la maintenance', 'maintenance-off': 'a coupé la maintenance',
    'backup-create': 'a créé une sauvegarde', 'backup-delete': 'a supprimé une sauvegarde', 'backup-restore': 'a restauré une sauvegarde',
  };
  const BKIND = { auto: 'Automatique', manual: 'Manuelle', 'pre-restore': 'Avant restauration' };
  const n = (v) => Number(v || 0).toLocaleString('fr-FR');

  function ago(ts) {
    if (!ts) return '—';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'à l’instant';
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    if (s < 30 * 86400) return `il y a ${Math.floor(s / 86400)} j`;
    return new Date(ts).toLocaleDateString('fr-FR');
  }
  const size = (b) => (b < 1024 ? `${b} o` : b < 1048576 ? `${(b / 1024).toFixed(1)} Ko` : `${(b / 1048576).toFixed(1)} Mo`);
  function duration(sec) {
    const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d ? `${d} j ${hh} h` : hh ? `${hh} h ${m} min` : `${m} min`;
  }

  function toast(msg, kind) {
    const t = h('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: msg });
    const box = $('#toasts');
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.remove(), 3200);
  }

  async function api(path, body) {
    let r;
    try {
      r = await fetch(path, body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { cache: 'no-store' });
    } catch { throw new Error('Serveur injoignable.'); }
    if (r.status === 401) { location.href = '/auth/login?next=admin'; throw new Error('Connexion requise.'); }
    let j = null;
    try { j = await r.json(); } catch { /* non JSON */ }
    if (!r.ok) throw new Error((j && j.error) || 'Erreur serveur.');
    return j;
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'bad'); } };

  const person = (u) => h('div', { class: 'person' },
    h('img', { src: u.avatar, alt: '', width: '32', height: '32', referrerpolicy: 'no-referrer' }),
    h('div', {}, h('b', { text: u.pending ? '(pas encore connecté)' : u.name }), h('small', { text: u.id })));

  const badges = (u) => [
    h('span', { class: `badge ${u.role}`, text: ROLE[u.role] }),
    u.banned ? h('span', { class: 'badge banned', title: u.banned.reason, text: 'Banni' }) : null,
    u.pending ? h('span', { class: 'badge pending', text: 'En attente' }) : null,
  ];

  /* ───── Vue d'ensemble ───── */
  async function renderOverview() {
    const o = await api('/api/admin/overview');
    const c = o.counts;
    const kpi = (label, v) => h('div', { class: 'kpi' }, h('span', { text: label }), h('b', { text: n(v) }));
    const max = Math.max(1, ...Object.values(o.affinities));
    const sv = o.server;
    const yn = (b) => h('span', { class: b ? 'ok' : 'ko', text: b ? 'Oui' : 'Non' });

    view.replaceChildren(
      h('div', { class: 'kpis' },
        kpi('Joueurs', c.users), kpi('Actifs 24 h', c.active24h), kpi('Actifs 7 j', c.active7d),
        kpi('Nouveaux 24 h', c.new24h), kpi('Niveau moyen', c.avgLevel), kpi('Bannis', c.banned),
        kpi('Équipe', c.admins), kpi('Connexions', o.stats.logins), kpi('Sauvegardes Discord', o.stats.backups), kpi('Restaurations', o.stats.restores)),
      h('div', { class: 'two' },
        h('section', { class: 'card' }, h('h2', { text: 'Affinités' }),
          h('div', { class: 'dist' }, Object.entries(o.affinities).map(([k, v]) => {
            const fill = h('div', {});
            fill.style.width = `${(v / max) * 100}%`;
            fill.style.background = AFF_COLOR[k];
            return h('div', { class: 'dist-row' }, h('span', { text: AFF[k] }), h('div', { class: 'bar' }, fill), h('b', { text: n(v) }));
          }))),
        h('section', { class: 'card' }, h('h2', { text: 'Serveur' }),
          h('dl', { class: 'kv' },
            h('dt', { text: 'En ligne depuis' }), h('dd', { text: duration(sv.uptime) }),
            h('dt', { text: 'Mémoire' }), h('dd', { text: `${sv.rssMb} Mo` }),
            h('dt', { text: 'Node' }), h('dd', { text: sv.node }),
            h('dt', { text: 'Connexion obligatoire' }), h('dd', {}, yn(sv.requireLogin)),
            h('dt', { text: 'Sauvegarde Discord' }), h('dd', {}, yn(sv.discordBackup)),
            h('dt', { text: 'Données persistantes' }), h('dd', {}, yn(sv.persistent)),
            h('dt', { text: 'Maintenance' }), h('dd', {}, h('span', { class: o.settings.maintenance.on ? 'ko' : 'ok', text: o.settings.maintenance.on ? 'Active' : 'Non' })),
            h('dt', { text: 'Dernière sauvegarde' }), h('dd', {}, h('span', { class: o.backups.last ? 'ok' : 'ko', text: o.backups.last ? ago(o.backups.last) : 'Aucune' }))),
          sv.persistent ? null : h('p', { class: 'muted', style: 'margin-top:12px', text: 'Écriture impossible : monte un Volume Railway et définis DATA_DIR.' }))),
      h('section', { class: 'card' }, h('h2', { text: 'Meilleurs joueurs' }),
        o.top.length ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Joueur', 'Niveau', 'Affinité', 'Forme', 'Victoires'].map((t) => h('th', { text: t })))),
          h('tbody', {}, o.top.map((u) => h('tr', {},
            h('td', {}, person(u)), h('td', { text: u.progress.level }), h('td', { text: AFF[u.progress.affinity] || '—' }),
            h('td', { text: FORM[u.progress.form] }), h('td', { text: n(u.progress.wins) })))))) : h('p', { class: 'empty', text: 'Aucune progression reçue pour le moment.' })));
  }

  /* ───── Joueurs ───── */
  const P = { q: '', filter: 'all', sort: 'recent', page: 1 };

  async function renderPlayers() {
    const list = h('div', {});
    let timer;
    const reload = guard(async () => {
      const qs = new URLSearchParams(P).toString();
      const d = await api(`/api/admin/users?${qs}`);
      P.page = d.page;
      list.replaceChildren(table(d), h('div', { class: 'pager' },
        h('span', { text: `${n(d.total)} résultat(s) · page ${d.page}/${d.pages}` }),
        h('div', { class: 'acts' },
          h('button', { class: 'btn small', disabled: d.page <= 1, onclick: () => { P.page--; reload(); }, text: '← Précédent' }),
          h('button', { class: 'btn small', disabled: d.page >= d.pages, onclick: () => { P.page++; reload(); }, text: 'Suivant →' }))));
    });
    const sel = (key, opts) => {
      const el = h('select', { onchange: (e) => { P[key] = e.target.value; P.page = 1; reload(); } },
        opts.map(([v, t]) => h('option', { value: v, text: t })));
      el.value = P[key];
      return el;
    };
    const search = h('input', { type: 'text', placeholder: 'Rechercher un pseudo ou un ID Discord…', value: P.q, maxlength: '40', autocomplete: 'off',
      oninput: (e) => { clearTimeout(timer); timer = setTimeout(() => { P.q = e.target.value; P.page = 1; reload(); }, 250); } });

    const parts = [h('div', { class: 'toolbar' }, search,
      sel('filter', [['all', 'Tous'], ['staff', 'Équipe'], ['banned', 'Bannis']]),
      sel('sort', [['recent', 'Dernière connexion'], ['new', 'Plus récents'], ['level', 'Niveau']]))];

    parts.push(h('section', { class: 'card', style: 'margin-bottom:14px' }, h('h2', { text: 'Pour moi' }),
      h('button', { class: 'btn primary', text: 'Me donner des récompenses…', onclick: () => giveDialog({ id: ME.id, name: 'moi' }) })));
    if (ME.role === 'founder') {
      parts.push(h('section', { class: 'card', style: 'margin-bottom:14px' }, h('h2', { text: 'Cadeau pour tous' }),
        h('div', { class: 'inline' }, h('button', { class: 'btn primary', text: 'Donner à tous les joueurs…', onclick: () => giveDialog({ id: 'all', name: 'tous les joueurs' }) }),
          h('span', { class: 'pill-note', style: 'margin:0', text: 'Réservé au fondateur (bannis exclus).' }))));
      const idInput = h('input', { type: 'text', placeholder: 'ID Discord à nommer admin', maxlength: '25', inputmode: 'numeric', autocomplete: 'off' });
      parts.push(h('section', { class: 'card', style: 'margin-bottom:14px' }, h('h2', { text: 'Ajouter un admin' }),
        h('div', { class: 'inline' }, idInput, h('button', { class: 'btn primary', text: 'Nommer admin', onclick: guard(async () => {
          const id = idInput.value.trim();
          if (!/^\d{15,25}$/.test(id)) { toast('ID Discord invalide.', 'bad'); return; }
          if (!confirm(`Donner les droits admin à ${id} ?`)) return;
          await api('/api/admin/role', { id, role: 'admin' });
          idInput.value = '';
          toast('Admin ajouté.', 'good');
          reload();
        }) })),
        h('p', { class: 'pill-note', style: 'margin:8px 0 0', text: 'Discord : Paramètres → Avancés → Mode développeur, puis clic droit sur le profil → Copier l’identifiant.' })));
    }
    parts.push(h('section', { class: 'card' }, list));
    view.replaceChildren(...parts);
    reload();

    function table(d) {
      if (!d.items.length) return h('p', { class: 'empty', text: 'Aucun joueur.' });
      return h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Joueur', 'Statut', 'Progression', 'Dernière connexion', 'Actions'].map((t) => h('th', { text: t })))),
        h('tbody', {}, d.items.map((u) => h('tr', {},
          h('td', {}, person(u)),
          h('td', {}, h('div', { class: 'acts' }, badges(u))),
          h('td', { text: u.progress ? `Niv. ${u.progress.level} · ${AFF[u.progress.affinity] || 'sans affinité'} · ${FORM[u.progress.form]}` : '—' }),
          h('td', { text: ago(u.lastSeen) }),
          h('td', {}, actions(u, reload)))))));
    }
  }

  /* ───── Cadeaux : tout donner à un joueur (ou à tous) ───── */
  function giveDialog(u) {
    const all = u.id === 'all';
    const dlg = h('dialog', { class: 'give' });
    const num = (ph, max) => h('input', { type: 'number', min: '0', max: String(max), placeholder: ph, inputmode: 'numeric' });
    const level = num('Niveau (1–100)', 100), xp = num('XP à ajouter', 1e9), reiatsu = num('Argent (reiatsu) à ajouter', 1e14), wins = num('Victoires à ajouter', 1e6);
    const upg = { focus: num('Concentration (0–500)', 500), aura: num('Aura (0–500)', 500), discipline: num('Discipline (0–500)', 500) };
    const shikai = h('input', { type: 'checkbox' }), bankai = h('input', { type: 'checkbox' });
    const affinity = h('select', {}, [['', 'Affinité : ne pas toucher'], ...Object.entries(AFF)].map(([v, t]) => h('option', { value: v, text: t })));
    const formSel = h('select', {}, [['', 'Forme : ne pas toucher'], ['shikai', 'Forme Shikai'], ['bankai', 'Forme Bankai']].map(([v, t]) => h('option', { value: v, text: t })));

    const body = () => ({
      id: u.id, level: Number(level.value) || 0, xp: Number(xp.value) || 0, reiatsu: Number(reiatsu.value) || 0, wins: Number(wins.value) || 0,
      shikai: shikai.checked, bankai: bankai.checked, affinity: affinity.value, form: formSel.value,
      upg: { focus: Number(upg.focus.value) || 0, aura: Number(upg.aura.value) || 0, discipline: Number(upg.discipline.value) || 0 },
    });
    const send = (extra, label) => guard(async () => {
      const who = all ? 'TOUS les joueurs' : u.name;
      if (!confirm(`${label} à ${who} ?`)) return;
      const r = await api('/api/admin/give', { ...body(), ...extra });
      toast(all ? `Cadeau envoyé à ${r.count} joueur(s).` : 'Cadeau envoyé.', 'good');
      dlg.close();
    });
    const field = (label, el) => h('label', { class: 'fld' }, h('span', { text: label }), el);

    dlg.append(
      h('h2', { text: all ? 'Donner à tous les joueurs' : `Donner à ${u.name}` }),
      h('p', { class: 'pill-note', style: 'margin:0 0 12px', text: 'Le joueur reçoit le cadeau à sa prochaine synchro (≤ 1 min s’il est en ligne, sinon à sa connexion). Niveau, améliorations et déblocages ne peuvent qu’augmenter ; reiatsu, XP et victoires s’ajoutent.' }),
      h('button', { class: 'btn primary', type: 'button', text: '⚡ Tout donner (niv. 100, argent, Shikai, Bankai, tout au max)', onclick: send({ preset: 'all' }, 'Tout donner') }),
      h('div', { class: 'acts', style: 'margin-top:10px' },
        h('button', { class: 'btn small', type: 'button', text: 'Niveau max', onclick: () => { level.value = 100; } }),
        h('button', { class: 'btn small', type: 'button', text: 'Argent max', onclick: () => { reiatsu.value = 1e14; } }),
        h('button', { class: 'btn small', type: 'button', text: 'Améliorations max', onclick: () => { for (const k of Object.keys(upg)) upg[k].value = 500; } })),
      h('div', { class: 'give-grid' },
        field('Niveau', level), field('XP', xp), field('Argent (reiatsu)', reiatsu), field('Victoires', wins),
        field('Concentration', upg.focus), field('Aura', upg.aura), field('Discipline', upg.discipline),
        field('Affinité', affinity), field('Forme', formSel)),
      h('div', { class: 'inline', style: 'margin:12px 0' },
        h('label', { class: 'switch' }, shikai, 'Débloquer le Shikai'),
        h('label', { class: 'switch' }, bankai, 'Débloquer le Bankai (donne aussi le Shikai)')),
      h('div', { class: 'acts' },
        h('button', { class: 'btn primary', type: 'button', text: 'Envoyer', onclick: send({}, 'Envoyer ce cadeau') }),
        h('button', { class: 'btn', type: 'button', text: 'Annuler', onclick: () => dlg.close() })));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  function actions(u, reload) {
    const out = [h('button', { class: 'btn small primary', text: u.pendingGrants ? `Donner (${u.pendingGrants} en attente)` : 'Donner', onclick: () => giveDialog(u) })];
    const isSelf = u.id === ME.id;
    const canBan = !isSelf && u.role !== 'founder' && (u.role !== 'admin' || ME.role === 'founder') && !u.pending;
    if (u.banned && canBan) {
      out.push(h('button', { class: 'btn small', text: 'Débannir', onclick: guard(async () => {
        await api('/api/admin/unban', { id: u.id }); toast('Joueur débanni.', 'good'); reload();
      }) }));
    } else if (canBan) {
      out.push(h('button', { class: 'btn small danger', text: 'Bannir', onclick: guard(async () => {
        const reason = prompt(`Bannir ${u.name} ?\nRaison (affichée au joueur) :`, '');
        if (reason === null) return;
        await api('/api/admin/ban', { id: u.id, reason }); toast('Joueur banni.', 'good'); reload();
      }) }));
    }
    if (ME.role === 'founder' && u.role !== 'founder') {
      const promote = u.role !== 'admin';
      out.push(h('button', { class: 'btn small', text: promote ? 'Nommer admin' : 'Retirer admin', onclick: guard(async () => {
        if (!confirm(promote ? `Nommer ${u.name} admin ?` : `Retirer les droits admin de ${u.name} ?`)) return;
        await api('/api/admin/role', { id: u.id, role: promote ? 'admin' : 'player' });
        toast('Rôle mis à jour.', 'good'); reload();
      }) }));
    }
    return h('div', { class: 'acts' }, out);
  }

  /* ───── Serveur : annonce + maintenance ───── */
  async function renderServer() {
    const { settings } = await api('/api/admin/overview');
    const a = settings.announcement, m = settings.maintenance;
    const text = h('textarea', { rows: '3', maxlength: '280', placeholder: 'Message affiché en haut du jeu pour tous les joueurs…', text: a ? a.text : '' });
    const level = h('select', {}, [['info', 'Information'], ['good', 'Bonne nouvelle'], ['warn', 'Attention']].map(([v, t]) => h('option', { value: v, text: t })));
    level.value = a ? a.level : 'info';
    const on = h('input', { type: 'checkbox' });
    on.checked = !!m.on;
    const msg = h('input', { type: 'text', maxlength: '200', placeholder: 'Message de maintenance (optionnel)', value: m.message || '' });

    view.replaceChildren(h('div', { class: 'two' },
      h('section', { class: 'card' }, h('h2', { text: 'Annonce' }),
        h('div', { class: 'form-grid' }, text, level,
          h('div', { class: 'acts' },
            h('button', { class: 'btn primary', text: 'Publier', onclick: guard(async () => {
              if (!text.value.trim()) { toast('Écris un message.', 'bad'); return; }
              await api('/api/admin/announce', { text: text.value, level: level.value }); toast('Annonce publiée.', 'good');
            }) }),
            h('button', { class: 'btn', text: 'Retirer', onclick: guard(async () => {
              await api('/api/admin/announce', { text: '' }); text.value = ''; toast('Annonce retirée.', 'good');
            }) })),
          h('p', { class: 'pill-note', style: 'margin:0', text: 'Les joueurs la voient dans la minute ; ils peuvent la fermer.' }))),
      h('section', { class: 'card' }, h('h2', { text: 'Maintenance' }),
        h('div', { class: 'form-grid' },
          h('label', { class: 'switch' }, on, 'Fermer le jeu aux joueurs (l’équipe garde l’accès)'),
          msg,
          h('button', { class: 'btn primary', text: 'Enregistrer', onclick: guard(async () => {
            await api('/api/admin/maintenance', { on: on.checked, message: msg.value });
            toast(on.checked ? 'Maintenance activée.' : 'Maintenance désactivée.', 'good');
          }) })))));
  }

  /* ───── Sauvegardes ───── */
  function download(name, obj) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function renderBackups() {
    const d = await api('/api/admin/backups');
    const founder = ME.role === 'founder';
    const reload = guard(renderBackups);

    const file = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: guard(async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 10 * 1048576) { toast('Fichier trop volumineux (10 Mo max).', 'bad'); return; }
      let doc;
      try { doc = JSON.parse(await f.text()); } catch { toast('Ce fichier n’est pas du JSON valide.', 'bad'); return; }
      if (!confirm(`Restaurer « ${f.name} » ?\nTOUS les joueurs, rôles, bans, réglages et le journal seront remplacés.\nUne sauvegarde « avant restauration » est créée automatiquement.`)) return;
      await api('/api/admin/backup/restore', { doc });
      toast('Base restaurée.', 'good'); reload();
    }) });

    const rows = d.items.map((b) => h('tr', {},
      h('td', { text: new Date(b.at).toLocaleString('fr-FR') }),
      h('td', {}, h('span', { class: 'badge', text: BKIND[b.kind] || b.kind })),
      h('td', { text: size(b.size) }),
      h('td', {}, founder ? h('div', { class: 'acts' },
        h('button', { class: 'btn small', text: 'Télécharger', onclick: guard(async () => { download(b.name, await api(`/api/admin/backup/get?name=${encodeURIComponent(b.name)}`)); }) }),
        h('button', { class: 'btn small', text: 'Restaurer', onclick: guard(async () => {
          if (!confirm(`Restaurer la sauvegarde du ${new Date(b.at).toLocaleString('fr-FR')} ?\nTOUS les joueurs, rôles, bans, réglages et le journal seront remplacés.\nUne sauvegarde « avant restauration » est créée automatiquement.`)) return;
          await api('/api/admin/backup/restore', { name: b.name });
          toast('Base restaurée.', 'good'); reload();
        }) }),
        h('button', { class: 'btn small danger', text: 'Supprimer', onclick: guard(async () => {
          if (!confirm('Supprimer cette sauvegarde ?')) return;
          await api('/api/admin/backup/delete', { name: b.name });
          toast('Sauvegarde supprimée.', 'good'); reload();
        }) })) : h('small', { class: 'muted', text: 'Fondateur uniquement' }))));

    view.replaceChildren(
      h('section', { class: 'card', style: 'margin-bottom:14px' }, h('h2', { text: 'Sauvegardes de la base' }),
        h('p', { class: 'pill-note', style: 'margin:0 0 12px', text: 'Joueurs, rôles, bans, annonce, maintenance et journal. Une sauvegarde automatique est faite chaque jour (7 conservées), les manuelles sont gardées par lot de 20.' }),
        d.persistent ? null : h('p', { class: 'ko', style: 'margin:0 0 12px', text: 'Écriture impossible sur le disque : monte un Volume Railway et définis DATA_DIR, sinon rien ne survit à un redéploiement.' }),
        h('div', { class: 'acts' },
          h('button', { class: 'btn primary', text: 'Sauvegarder maintenant', onclick: guard(async () => {
            await api('/api/admin/backup/create', {}); toast('Sauvegarde créée.', 'good'); reload();
          }) }),
          founder ? h('button', { class: 'btn', text: 'Restaurer depuis un fichier…', onclick: () => file.click() }) : null, file),
        h('p', { class: 'pill-note', style: 'margin:12px 0 0', text: 'Sur Railway, sans Volume, ce dossier est effacé à chaque déploiement : télécharge de temps en temps une sauvegarde sur ton ordinateur.' })),
      h('section', { class: 'card' }, h('h2', { text: 'Sauvegardes disponibles' }),
        rows.length ? h('div', { class: 'scroll' }, h('table', { style: 'min-width:560px' },
          h('thead', {}, h('tr', {}, ['Date', 'Type', 'Taille', 'Actions'].map((t) => h('th', { text: t })))),
          h('tbody', {}, rows))) : h('p', { class: 'empty', text: 'Aucune sauvegarde pour le moment.' })));
  }

  /* ───── Journal ───── */
  async function renderAudit() {
    const { items } = await api('/api/admin/audit');
    view.replaceChildren(h('section', { class: 'card' }, h('h2', { text: 'Journal' }),
      items.length ? h('ul', { class: 'audit' }, items.map((e) => h('li', {},
        h('time', { text: ago(e.t), title: new Date(e.t).toLocaleString('fr-FR') }),
        h('span', {}, h('b', { text: e.actor }), ` ${ACTIONS[e.action] || e.action}`, e.target ? ' ' : '', e.target ? h('b', { text: e.target }) : null,
          e.detail ? h('span', { class: 'pill-note', text: ` — ${e.detail}` }) : null)))) : h('p', { class: 'empty', text: 'Rien pour le moment.' })));
  }

  /* ───── Navigation ───── */
  const TABS = { overview: ['Vue d’ensemble', renderOverview], players: ['Joueurs', renderPlayers], server: ['Annonce & maintenance', renderServer], backups: ['Sauvegardes', renderBackups], audit: ['Journal', renderAudit] };
  function go(key) {
    if (!TABS[key]) key = 'overview';
    history.replaceState(null, '', `#${key}`);
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === key));
    view.replaceChildren(h('p', { class: 'empty', text: 'Chargement…' }));
    guard(TABS[key][1])();
  }

  (async () => {
    try {
      const o = await api('/api/admin/overview');
      ME = o.me;
      $('#who').textContent = `${ME.name} · ${ROLE[ME.role]}`;
      const nav = $('#tabs');
      for (const [k, [label]] of Object.entries(TABS)) nav.append(h('button', { class: 'tab', type: 'button', role: 'tab', 'data-tab': k, text: label, onclick: () => go(k) }));
      go(location.hash.slice(1));
    } catch (e) { view.replaceChildren(h('p', { class: 'empty', text: e.message })); }
  })();
})();
