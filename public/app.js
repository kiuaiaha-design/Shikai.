'use strict';
(() => {
  /* ═════════ Données du jeu ═════════ */
  const GAME_ID = 'soul-forge';
  const SAVE_KEY = 'soulforge.save.v1';
  const MAX_LEVEL = 100;
  const SHIKAI_LEVEL = 10;
  const BANKAI_LEVEL = 30;
  const BANKAI_MASTERY = 15; // victoires en forme Shikai
  const TRIAL_POWER = { shikai: 160, bankai: 1100 };
  const DEFAULT_COLOR = '#9d6bff';
  const DEFAULT_COLOR2 = '#00e5ff';

  // Zanpakutō originaux : tu peux en ajouter ici, tout le reste s'adapte.
  const AFFINITIES = [
    {
      id: 'feu', label: 'Feu', kanji: '炎', color: '#ff5a1f', color2: '#ff2d95',
      name: 'Enjū', cmd: 'Dévore, Enjū', bankai: 'Enjū Kōrin',
      shikaiDesc: 'Une lame ceinte de braises vivantes : chaque frappe embrase l’air autour d’elle.',
      bankaiDesc: 'Un soleil noir s’abat sur le champ de bataille et consume le reiatsu de tout ce qu’il touche.',
    },
    {
      id: 'glace', label: 'Glace', kanji: '氷', color: '#2ef2ff', color2: '#7a5cff',
      name: 'Reika', cmd: 'Fige l’aube, Reika', bankai: 'Reika Hyōten',
      shikaiDesc: 'Une lame de givre pur. Le moindre contact fait naître des fleurs de glace sur l’adversaire.',
      bankaiDesc: 'Le ciel entier se fige : un royaume de glace où le temps lui-même ralentit.',
    },
    {
      id: 'foudre', label: 'Foudre', kanji: '雷', color: '#ffe629', color2: '#ff7a1a',
      name: 'Raikō', cmd: 'Fends le ciel, Raikō', bankai: 'Raikō Tenmei',
      shikaiDesc: 'Une lame crépitante qui frappe avant même que l’éclair ne soit vu.',
      bankaiDesc: 'Ton corps devient orage : chaque pas est un coup de tonnerre, chaque souffle une tempête.',
    },
    {
      id: 'ombre', label: 'Ombre', kanji: '影', color: '#b565ff', color2: '#ff3dd8',
      name: 'Kagerō', cmd: 'Engloutis la nuit, Kagerō', bankai: 'Kagerō Yamiyo',
      shikaiDesc: 'Une lame sans reflet. Ton ombre prend vie et frappe depuis les angles morts.',
      bankaiDesc: 'La nuit absolue tombe : tout ce qui existe dans ton domaine t’appartient.',
    },
    {
      id: 'vent', label: 'Vent', kanji: '風', color: '#39ff9c', color2: '#00cfff',
      name: 'Shinkū', cmd: 'Déchire le vide, Shinkū', bankai: 'Shinkū Tenpū',
      shikaiDesc: 'Une lame invisible qui tranche à distance : le vent obéit à ton poignet.',
      bankaiDesc: 'Un typhon à ta mesure : le vide se referme sur tes ennemis.',
    },
  ];
  const AFF = Object.fromEntries(AFFINITIES.map((a) => [a.id, a]));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  const FORMS = {
    scelle: { label: 'Scellé', pow: 1, gain: 1 },
    shikai: { label: 'Shikai', pow: 2, gain: 1.5 },
    bankai: { label: 'Bankai', pow: 4.5, gain: 3 },
  };

  const UPGRADES = [
    { id: 'focus', label: 'Concentration', desc: '+1 reiatsu par clic', base: 15, growth: 1.17 },
    { id: 'aura', label: 'Aura', desc: '+1,5 reiatsu par seconde', base: 60, growth: 1.18 },
    { id: 'discipline', label: 'Discipline', desc: '+8 puissance au combat', base: 120, growth: 1.2 },
  ];
  const MAX_UPG = 500;

  /* ═════════ Utilitaires ═════════ */
  const $ = (s) => document.querySelector(s);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function fmt(n) {
    n = Math.floor(n);
    if (n < 10000) return n.toLocaleString('fr-FR');
    const units = ['K', 'M', 'Md', 'B', 'Bd'];
    let v = n, i = -1;
    while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
    const s = (v >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '').replace('.', ',');
    return `${s} ${units[i]}`;
  }
  function fmtD(n) {
    return n < 100 ? n.toFixed(1).replace(/\.0$/, '').replace('.', ',') : fmt(n);
  }
  function num(v, min, max, def) {
    v = Number(v);
    if (!Number.isFinite(v)) return def;
    return Math.min(max, Math.max(min, v));
  }

  /* ═════════ État & sauvegarde ═════════ */
  const needXp = (lv) => Math.floor(25 * Math.pow(lv, 1.35));

  function defaultState() {
    return {
      v: 1, name: 'Shinigami', reiatsu: 0, xp: 0, level: 1,
      clicks: 0, wins: 0, losses: 0, mastery: 0,
      affinity: null, unlocked: { shikai: false, bankai: false }, form: 'scelle',
      upg: { focus: 0, aura: 0, discipline: 0 },
      custom: { shikai: '', cmd: '', bankai: '' },
      created: Date.now(), updated: Date.now(),
    };
  }

  function cleanText(v, max) {
    return typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }
  // Noms personnalisés (vides = noms par défaut de l'affinité)
  const zName = (a) => S.custom.shikai || a.name;
  const zCmd = (a) => S.custom.cmd || a.cmd;
  const bName = (a) => S.custom.bankai || a.bankai;

  // Nettoie / borne toute donnée venant du stockage, d'un fichier ou d'un code.
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const d = defaultState();
    if (typeof raw.name === 'string') {
      d.name = raw.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || d.name;
    }
    d.level = Math.floor(num(raw.level, 1, MAX_LEVEL, 1));
    d.xp = d.level >= MAX_LEVEL ? 0 : Math.min(num(raw.xp, 0, 1e12, 0), needXp(d.level) - 1);
    d.reiatsu = num(raw.reiatsu, 0, 1e15, 0);
    d.clicks = Math.floor(num(raw.clicks, 0, 1e12, 0));
    d.wins = Math.floor(num(raw.wins, 0, 1e9, 0));
    d.losses = Math.floor(num(raw.losses, 0, 1e9, 0));
    d.mastery = Math.floor(num(raw.mastery, 0, 1e9, 0));
    d.affinity = typeof raw.affinity === 'string' && has(AFF, raw.affinity) ? raw.affinity : null;
    const u = raw.unlocked && typeof raw.unlocked === 'object' ? raw.unlocked : {};
    d.unlocked.shikai = !!u.shikai && !!d.affinity;
    d.unlocked.bankai = !!u.bankai && d.unlocked.shikai;
    d.form = typeof raw.form === 'string' && (raw.form === 'scelle' || (has(FORMS, raw.form) && d.unlocked[raw.form])) ? raw.form : 'scelle';
    const up = raw.upg && typeof raw.upg === 'object' ? raw.upg : {};
    for (const k of Object.keys(d.upg)) d.upg[k] = Math.floor(num(up[k], 0, MAX_UPG, 0));
    const cu = raw.custom && typeof raw.custom === 'object' ? raw.custom : {};
    for (const [k, max] of [['shikai', 30], ['cmd', 48], ['bankai', 30]]) d.custom[k] = cleanText(cu[k], max);
    d.created = num(raw.created, 0, Date.now() + 1e9, d.created);
    d.updated = num(raw.updated, 0, Date.now() + 1e9, d.updated);
    return d;
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) { const d = sanitize(JSON.parse(raw)); if (d) return d; }
    } catch { /* stockage indisponible ou corrompu */ }
    return defaultState();
  }

  let S = load();

  function setStatus(ok) {
    const el = $('#saveStatus');
    if (ok) {
      el.className = 'save-pill ok';
      el.textContent = 'Sauvegardé · ' + new Date().toLocaleTimeString('fr-FR');
    } else {
      el.className = 'save-pill err';
      el.textContent = 'Auto-sauvegarde indisponible — télécharge ta sauvegarde';
    }
  }

  function save() {
    S.updated = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); setStatus(true); }
    catch { setStatus(false); }
  }

  // Somme de contrôle (détecte un fichier abîmé ou modifié ; ce n'est pas un anti-triche).
  function checksum(str) {
    let x = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return x.toString(16).padStart(8, '0');
  }

  function buildExport() {
    const data = JSON.parse(JSON.stringify(S));
    data.updated = Date.now();
    return {
      game: GAME_ID, version: 1, exportedAt: new Date().toISOString(),
      checksum: checksum(JSON.stringify(data)), data,
    };
  }

  function b64e(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64d(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  function toCode() {
    const ex = buildExport();
    return 'SF1.' + b64e(JSON.stringify({ c: ex.checksum, d: ex.data }));
  }

  function importParsed(parsed) {
    let data, sum;
    if (parsed && parsed.game === GAME_ID && parsed.data) { data = parsed.data; sum = parsed.checksum; }
    else if (parsed && parsed.d && parsed.c) { data = parsed.d; sum = parsed.c; }
    else { toast('Fichier non reconnu.', 'bad'); return; }
    if (sum !== checksum(JSON.stringify(data))) { toast('Sauvegarde corrompue ou modifiée.', 'bad'); return; }
    const clean = sanitize(data);
    if (!clean) { toast('Sauvegarde invalide.', 'bad'); return; }
    if (!confirm(`Charger la sauvegarde de « ${clean.name} » (niv. ${clean.level}) ?\nTa progression actuelle sera remplacée.`)) return;
    S = clean;
    logs.length = 0;
    enemy = makeEnemy();
    save();
    renderAll();
    toast('Sauvegarde chargée.', 'good');
  }

  /* ═════════ Calculs ═════════ */
  const form = () => FORMS[S.form];
  const baseGain = () => 1 + S.upg.focus + Math.floor(S.level / 5);
  const clickGain = () => Math.max(1, Math.floor(baseGain() * form().gain));
  const perSec = () => S.upg.aura * 1.5 * form().gain;
  const basePower = () => S.level * 10 + S.upg.discipline * 8;
  const power = () => Math.floor(basePower() * form().pow);
  const chance = (p, e) => (p * p) / (p * p + e * e);
  const upgCost = (u) => Math.floor(u.base * Math.pow(u.growth, S.upg[u.id]));

  function gainXP(x) {
    if (S.level >= MAX_LEVEL) return;
    S.xp += x;
    let up = false;
    while (S.level < MAX_LEVEL && S.xp >= needXp(S.level)) {
      S.xp -= needXp(S.level);
      S.level++;
      up = true;
    }
    if (S.level >= MAX_LEVEL) S.xp = 0;
    if (up) {
      toast(`Niveau ${S.level} atteint !`, 'good');
      levelFx();
      if (S.level === SHIKAI_LEVEL || S.level === BANKAI_LEVEL) toast('Une épreuve t’attend dans ton Zanpakutō.');
      renderZan();
    }
  }

  /* ═════════ Effets visuels ═════════ */
  const fx = (() => {
    const cv = $('#fx');
    const ctx = cv.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0;
    let cols = ['157,107,255', '0,229,255'];
    let sprites = [];
    const parts = [];
    const rings = [];

    // Une pastille lumineuse pré-rendue par couleur : bien plus léger qu'un flou par particule.
    function sprite(rgb) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.18, `rgba(${rgb},0.95)`);
      g.addColorStop(0.5, `rgba(${rgb},0.28)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      return c;
    }
    function rebuild() { sprites = cols.map(sprite); }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function add(p) { if (parts.length < 650) parts.push(p); }
    function burst(x, y, n = 14, speed = 3) {
      if (reduce) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = (0.4 + Math.random()) * speed;
        add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.5, life: 40 + Math.random() * 34, max: 74, size: 1.4 + Math.random() * 2.6, g: 0.045, c: Math.random() < 0.35 ? 1 : 0, tw: 0 });
      }
    }
    function ring(x, y, r = 160, color = 0) {
      if (reduce) return;
      if (rings.length < 12) rings.push({ x, y, r: 6, max: r, c: color });
    }
    function shock() {
      burst(W / 2, H / 2, 260, 10);
      ring(W / 2, H / 2, Math.max(W, H) * 0.6, 0);
      setTimeout(() => ring(W / 2, H / 2, Math.max(W, H) * 0.45, 1), 140);
      setTimeout(() => ring(W / 2, H / 2, Math.max(W, H) * 0.3, 0), 280);
    }
    function frame() {
      requestAnimationFrame(frame);
      ctx.clearRect(0, 0, W, H);
      if (reduce) return;
      // braises d'âme qui montent
      if (parts.length < 90 && Math.random() < 0.4) {
        add({ x: Math.random() * W, y: H + 10, vx: (Math.random() - 0.5) * 0.4, vy: -(0.35 + Math.random() * 0.9), life: 520, max: 520, size: 1.2 + Math.random() * 2.6, g: 0, c: Math.random() < 0.3 ? 1 : 0, tw: Math.random() * 6.28 });
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (--p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        p.x += p.vx + (p.tw ? Math.sin(p.life * 0.03 + p.tw) * 0.25 : 0); p.y += p.vy; p.vy += p.g; p.vx *= 0.99;
        const a = Math.max(0, p.life / p.max);
        const flick = p.tw ? 0.65 + 0.35 * Math.sin(p.life * 0.12 + p.tw) : 1;
        const s = p.size * 4.5;
        ctx.globalAlpha = Math.min(1, a * 1.4) * flick;
        ctx.drawImage(sprites[p.c], p.x - s, p.y - s, s * 2, s * 2);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.r += (r.max - r.r) * 0.07 + 1.5;
        const a = 1 - r.r / r.max;
        if (a <= 0.02) { rings.splice(i, 1); continue; }
        ctx.globalAlpha = a;
        ctx.strokeStyle = `rgb(${cols[r.c]})`;
        ctx.lineWidth = 1 + a * 5;
        ctx.shadowColor = `rgb(${cols[r.c]})`;
        ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.283); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    window.addEventListener('resize', resize);
    rebuild();
    resize();
    frame();
    return { burst, shock, ring, setColor: (c1, c2) => { cols = [c1, c2]; rebuild(); } };
  })();

  const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  function applyAccent(hex, hex2) {
    const [r, g, b] = hexRgb(hex);
    const [r2, g2, b2] = hexRgb(hex2);
    const root = document.documentElement.style;
    root.setProperty('--accent', hex);
    root.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    root.setProperty('--accent2', hex2);
    root.setProperty('--accent2-rgb', `${r2}, ${g2}, ${b2}`);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#05030c');
    fx.setColor(`${r},${g},${b}`, `${r2},${g2},${b2}`);
  }

  function toast(msg, kind) {
    const t = h('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: msg });
    const box = $('#toasts');
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.remove(), 3200);
  }

  function floatText(txt, x, y) {
    const el = h('span', { class: 'float', text: txt });
    el.style.left = x - 12 + (Math.random() * 30 - 15) + 'px';
    el.style.top = y - 18 + 'px';
    document.body.append(el);
    setTimeout(() => el.remove(), 900);
  }

  function levelFx() {
    const el = $('#lvl');
    if (!el) return;
    el.classList.remove('up'); void el.offsetWidth; el.classList.add('up');
    const r = el.getBoundingClientRect();
    fx.ring(r.left + r.width / 2, r.top + r.height / 2, 260, 1);
    fx.burst(r.left + r.width / 2, r.top + r.height / 2, 50, 5);
  }

  /* ═════════ Combat ═════════ */
  let enemy = null;
  const logs = [];

  function enemyRef() {
    return basePower() * (S.unlocked.bankai ? 3.2 : S.unlocked.shikai ? 1.6 : 1);
  }
  function makeEnemy() {
    const r = 0.5 + Math.random() * 0.6;
    const tier = r < 0.68 ? 0 : r < 0.85 ? 1 : r < 1.0 ? 2 : 3;
    const names = ['Hollow errant', 'Hollow masqué', 'Hollow gardien', 'Grand Hollow'];
    return { pow: Math.max(6, Math.round(enemyRef() * r)), name: names[tier], tier };
  }

  function addLog(text, cls) {
    logs.unshift({ text, cls });
    if (logs.length > 8) logs.pop();
    $('#log').replaceChildren(...logs.map((l) => h('li', { class: l.cls, text: l.text })));
  }

  let cooling = false;
  function fight() {
    if (cooling) return;
    cooling = true;
    const btn = $('#fightBtn');
    btn.disabled = true;
    setTimeout(() => { cooling = false; btn.disabled = false; }, 450);

    const P = power(), E = enemy.pow;
    if (Math.random() < chance(P, E)) {
      const mult = S.unlocked.bankai ? 3.2 : S.unlocked.shikai ? 1.6 : 1;
      const rei = Math.floor((20 + S.level * 12) * mult);
      const xp = 20 + S.level * 7;
      S.reiatsu += rei; S.wins++;
      if (S.form === 'shikai') S.mastery++;
      addLog(`Victoire contre ${enemy.name} · +${fmt(rei)} reiatsu · +${fmt(xp)} XP`, 'win');
      gainXP(xp);
      const r = btn.getBoundingClientRect();
      fx.burst(r.left + r.width / 2, r.top + r.height / 2, 34, 4.5);
      fx.ring(r.left + r.width / 2, r.top + r.height / 2, 200, 0);
    } else {
      S.losses++;
      const loss = Math.floor(S.reiatsu * 0.03);
      S.reiatsu -= loss;
      addLog(`Défaite face à ${enemy.name} · −${fmt(loss)} reiatsu`, 'lose');
      gainXP(5);
      const fc = $('.card.fight');
      fc.classList.remove('shake'); void fc.offsetWidth; fc.classList.add('shake');
    }
    enemy = makeEnemy();
    renderStats();
    $('#enemy').classList.add('spawn');
    renderZan();
    save();
  }

  /* ═════════ Cadeaux de l'équipe (panel admin) ═════════ */
  // Appelé par session.js avec les cadeaux en attente. Renvoie les ids appliqués.
  function applyGrants(list) {
    const done = [];
    let any = false;
    for (const it of Array.isArray(list) ? list : []) {
      const g = it && it.g && typeof it.g === 'object' ? it.g : null;
      done.push(it && it.id);
      if (!g) continue;
      const parts = [];
      if (typeof g.affinity === 'string' && has(AFF, g.affinity)) { S.affinity = g.affinity; parts.push(`affinité ${AFF[g.affinity].label}`); }
      else if (!S.affinity && typeof g.affinityIfNone === 'string' && has(AFF, g.affinityIfNone)) { S.affinity = g.affinityIfNone; parts.push(`affinité ${AFF[g.affinityIfNone].label}`); }
      if (g.level) {
        const lv = Math.floor(num(g.level, 1, MAX_LEVEL, 1));
        if (lv > S.level) { S.level = lv; S.xp = 0; parts.push(`niveau ${lv}`); }
      }
      if (g.reiatsu) { const r = num(g.reiatsu, 0, 1e14, 0); S.reiatsu = Math.min(1e15, S.reiatsu + r); parts.push(`+${fmt(r)} reiatsu`); }
      if (g.wins) { const w = Math.floor(num(g.wins, 0, 1e6, 0)); S.wins += w; parts.push(`+${fmt(w)} victoires`); }
      if (g.upg && typeof g.upg === 'object') {
        for (const k of Object.keys(S.upg)) {
          const v = Math.floor(num(g.upg[k], 0, MAX_UPG, 0));
          if (v > S.upg[k]) { S.upg[k] = v; parts.push(`${UPGRADES.find((u) => u.id === k).label} ${v}`); }
        }
      }
      if ((g.shikai || g.bankai) && S.affinity) {
        if (g.shikai && !S.unlocked.shikai) { S.unlocked.shikai = true; parts.push('Shikai'); }
        if (g.bankai && !S.unlocked.bankai) {
          S.unlocked.shikai = true; S.unlocked.bankai = true;
          S.mastery = Math.max(S.mastery, BANKAI_MASTERY);
          parts.push('Bankai');
        }
      }
      if (typeof g.form === 'string' && has(FORMS, g.form) && S.unlocked[g.form]) S.form = g.form;
      if (g.xp) gainXP(num(g.xp, 0, 1e9, 0));
      if (parts.length) { toast(`Cadeau de l’équipe : ${parts.join(', ')}`, 'good'); addLog(`Cadeau de l’équipe : ${parts.join(', ')}.`, 'sys'); any = true; }
    }
    if (any) {
      enemy = makeEnemy();
      fx.shock();
      renderAll();
      save();
    }
    return done.filter(Boolean);
  }
  window.__sfApplyGrants = applyGrants;

  /* ═════════ Zanpakutō : choix, formes, épreuves ═════════ */
  function chooseAffinity(id) {
    const a = has(AFF, id) ? AFF[id] : null;
    if (!a || S.affinity) return;
    if (!confirm(`Lier ton âme au ${a.label} ?\nLe zanpakutō « ${a.name} » sera ton compagnon (changement possible uniquement via une réinitialisation).`)) return;
    S.affinity = id;
    addLog(`Ton âme s’éveille : ${zName(a)} répond à ton appel.`, 'sys');
    fx.burst(window.innerWidth / 2, window.innerHeight / 2, 80, 5);
    renderZan();
    save();
    toast(`${zName(a)} est lié à ton âme.`, 'good');
  }

  function setForm(f) {
    if (!has(FORMS, f) || (f !== 'scelle' && !S.unlocked[f])) return;
    S.form = f;
    renderZan();
    renderStats();
    save();
  }

  function bankaiReqs() {
    return {
      shikai: S.unlocked.shikai,
      level: S.level >= BANKAI_LEVEL,
      mastery: S.mastery >= BANKAI_MASTERY,
    };
  }

  function trial(kind) {
    if (!S.affinity) return;
    if (kind === 'shikai') {
      if (S.unlocked.shikai || S.level < SHIKAI_LEVEL) return;
    } else if (kind === 'bankai') {
      const r = bankaiReqs();
      if (S.unlocked.bankai || !(r.shikai && r.level && r.mastery)) return;
    } else return;

    const P = power(), E = TRIAL_POWER[kind];
    const label = kind === 'shikai' ? 'Épreuve du Shikai' : 'Épreuve du Bankai';
    if (Math.random() < chance(P, E)) {
      S.unlocked[kind] = true;
      S.form = kind;
      addLog(`${label} réussie ! ${kind === 'shikai' ? 'Shikai' : 'Bankai'} éveillé.`, 'win');
      renderAll();
      save();
      showRelease(kind);
    } else {
      addLog(`${label} échouée. Entraîne-toi et réessaie.`, 'lose');
      toast(`${label} échouée… renforce-toi.`, 'bad');
    }
  }

  let relTimer = null;
  function showRelease(kind) {
    const a = AFF[S.affinity];
    if (!a) return;
    const el = $('#release');
    el.dataset.type = kind;
    $('#relType').textContent = kind === 'bankai' ? 'BANKAI' : 'SHIKAI';
    $('#relKanji').textContent = a.kanji;
    $('#relCmd').textContent = kind === 'bankai' ? 'Bankai' : zCmd(a);
    $('#relName').textContent = kind === 'bankai' ? bName(a) : zName(a);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    fx.shock();
    clearTimeout(relTimer);
    relTimer = setTimeout(hideRelease, 4600);
  }
  function hideRelease() { $('#release').classList.remove('show'); }

  /* ═════════ Rendu ═════════ */
  const upRefs = {};

  function renderUpgrades() {
    const box = $('#upgrades');
    box.replaceChildren();
    for (const u of UPGRADES) {
      const lv = h('span', { class: 'up-lv' });
      const btn = h('button', { class: 'btn buy' });
      btn.addEventListener('click', () => buy(u));
      upRefs[u.id] = { lv, btn };
      box.append(h('div', { class: 'up' },
        h('div', {}, h('div', { class: 'up-title' }, u.label, lv), h('div', { class: 'muted', text: u.desc })),
        btn));
    }
    updateUpgrades();
  }

  function updateUpgrades() {
    for (const u of UPGRADES) {
      const r = upRefs[u.id];
      if (!r) continue;
      const c = upgCost(u);
      const maxed = S.upg[u.id] >= MAX_UPG;
      r.lv.textContent = ` · niv. ${S.upg[u.id]}`;
      r.btn.textContent = maxed ? 'Maximum' : `Acheter · ${fmt(c)}`;
      r.btn.disabled = maxed || S.reiatsu < c;
    }
  }

  function buy(u) {
    const c = upgCost(u);
    if (S.upg[u.id] >= MAX_UPG || S.reiatsu < c) return;
    S.reiatsu -= c;
    S.upg[u.id]++;
    renderStats();
    renderZan();
    save();
  }

  function setNum(sel, v) {
    const el = $(sel);
    if (el.textContent === v) return;
    el.textContent = v;
    el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
  }

  function renderStats() {
    $('#lvl').textContent = S.level;
    $('#xpTxt').textContent = S.level >= MAX_LEVEL ? 'NIVEAU MAX' : `${fmt(S.xp)} / ${fmt(needXp(S.level))}`;
    $('#xpbar').style.width = (S.level >= MAX_LEVEL ? 100 : (S.xp / needXp(S.level)) * 100) + '%';
    setNum('#rei', fmt(S.reiatsu));
    $('#ps').textContent = fmtD(perSec());
    setNum('#pow', fmt(power()));
    setNum('#wins', fmt(S.wins));
    $('#orbSub').textContent = `+${fmt(clickGain())} reiatsu`;
    updateUpgrades();
    renderEnemy();
  }

  function renderEnemy() {
    if (!enemy) return;
    const el = $('#enemy');
    el.className = 'enemy t' + enemy.tier;
    $('#enemyName').textContent = enemy.name;
    const c = Math.round(chance(power(), enemy.pow) * 100);
    $('#enemyPow').textContent = `Puissance ${fmt(enemy.pow)} · chance de victoire ${c}%`;
  }

  function stageDone(title, cmd, desc, kind) {
    return h('div', { class: 'stage done' },
      h('h3', { text: title }),
      cmd ? h('p', { class: 'cmd', text: `« ${cmd} »` }) : null,
      h('p', { text: desc }),
      h('button', { class: 'btn small', 'data-replay': kind, text: 'Revoir l’éveil' }));
  }

  function req(ok, text) { return h('li', { class: ok ? 'ok' : '', text }); }

  function renderZan() {
    const box = $('#zanBody');
    box.replaceChildren();
    const a = AFF[S.affinity];
    applyAccent(a ? a.color : DEFAULT_COLOR, a ? a.color2 : DEFAULT_COLOR2);
    $('.brand-kanji').textContent = a ? a.kanji : '魂';

    if (!a) {
      box.append(
        h('p', { class: 'muted', text: 'Choisis l’affinité de ton âme. Ce choix est définitif tant que tu ne réinitialises pas ta progression.' }),
        h('div', { class: 'aff-grid' }, AFFINITIES.map((x) =>
          h('button', { class: 'aff', 'data-aff': x.id, style: `--c:${x.color}` },
            h('span', { class: 'aff-kanji', text: x.kanji }),
            h('span', { class: 'aff-label', text: x.label }),
            h('span', { class: 'aff-name', text: x.name })))));
      return;
    }

    const f = form();
    box.append(
      h('div', { class: 'zan-hero' },
        h('div', { class: 'zan-kanji', text: a.kanji }),
        h('div', {},
          h('div', { class: 'zan-name', text: zName(a) }),
          h('div', { class: 'muted', style: 'margin:0', text: `Affinité ${a.label} · forme ${f.label}` }))),
      h('div', { class: 'forms' }, ['scelle', 'shikai', 'bankai'].map((k) => {
        const open = k === 'scelle' || S.unlocked[k];
        return h('button', {
          class: 'form-btn' + (S.form === k ? ' on' : ''), 'data-form': k, disabled: !open,
          text: FORMS[k].label + (open ? '' : ' 🔒'),
        });
      })),
      h('p', { class: 'mult', text: `Forme active : puissance ×${f.pow} · reiatsu ×${f.gain}` }));

    // ── Shikai
    if (S.unlocked.shikai) {
      box.append(stageDone(`Shikai · ${zName(a)}`, zCmd(a), a.shikaiDesc, 'shikai'));
    } else {
      const okLv = S.level >= SHIKAI_LEVEL;
      box.append(h('div', { class: 'stage' },
        h('h3', { text: 'Shikai · état scellé' }),
        h('ul', { class: 'reqs' }, req(okLv, `Niveau ${SHIKAI_LEVEL} (actuel : ${S.level})`)),
        h('button', { class: 'btn primary', 'data-trial': 'shikai', disabled: !okLv, text: 'Tenter l’épreuve du Shikai' }),
        h('p', { class: 'chance', text: `Chance de réussite actuelle : ${Math.round(chance(power(), TRIAL_POWER.shikai) * 100)}% (le Gardien a ${TRIAL_POWER.shikai} de puissance). Monte ta Discipline !` })));
    }

    // ── Bankai
    if (S.unlocked.bankai) {
      box.append(stageDone(`Bankai · ${bName(a)}`, null, a.bankaiDesc, 'bankai'));
    } else {
      const r = bankaiReqs();
      const ready = r.shikai && r.level && r.mastery;
      box.append(h('div', { class: 'stage' },
        h('h3', { text: 'Bankai · forme ultime' }),
        h('ul', { class: 'reqs' },
          req(r.shikai, 'Shikai éveillé'),
          req(r.level, `Niveau ${BANKAI_LEVEL} (actuel : ${S.level})`),
          req(r.mastery, `Maîtrise du Shikai : ${Math.min(S.mastery, BANKAI_MASTERY)} / ${BANKAI_MASTERY} victoires en forme Shikai`)),
        h('button', { class: 'btn primary', 'data-trial': 'bankai', disabled: !ready, text: 'Tenter l’épreuve du Bankai' }),
        ready ? h('p', { class: 'chance', text: `Chance de réussite actuelle : ${Math.round(chance(power(), TRIAL_POWER.bankai) * 100)}% (le Gardien a ${fmt(TRIAL_POWER.bankai)} de puissance). Combats en forme Shikai pour maximiser tes chances.` }) : null));
    }

    // ── Noms personnalisés
    const inp = (key, label, ph, max) => h('label', { class: 'field' },
      h('span', { text: label }),
      h('input', { type: 'text', 'data-custom': key, maxlength: max, value: S.custom[key], placeholder: ph, autocomplete: 'off', spellcheck: 'false' }));
    box.append(h('div', { class: 'stage naming' },
      h('h3', { text: 'Baptise ton zanpakutō' }),
      h('p', { class: 'muted', text: 'Choisis le nom de ton Shikai, ta phrase d’invocation et le nom de ton Bankai. Laisse vide pour garder les noms d’origine.' }),
      inp('shikai', 'Nom du zanpakutō / Shikai', a.name, 30),
      inp('cmd', 'Phrase d’invocation', a.cmd, 48),
      inp('bankai', 'Nom du Bankai', a.bankai, 30),
      h('button', { class: 'btn small', 'data-resetnames': '1', text: 'Noms d’origine' })));
  }

  function renderAll() {
    const nameEl = $('#name');
    nameEl.value = S.name;
    renderZan();
    renderUpgrades();
    renderStats();
    $('#log').replaceChildren(...logs.map((l) => h('li', { class: l.cls, text: l.text })));
  }

  /* ═════════ Événements ═════════ */
  const orb = $('#orb');
  orb.addEventListener('click', (e) => {
    const g = clickGain();
    S.reiatsu += g; S.clicks++;
    gainXP(g * 0.5);
    let x = e.clientX, y = e.clientY;
    if (!e.detail || (!x && !y)) { const r = orb.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    floatText('+' + fmt(g), x, y);
    fx.burst(x, y, 8, 2.6);
    if (S.clicks % 5 === 0) fx.ring(x, y, 90, 1);
    orb.classList.remove('hit'); void orb.offsetWidth; orb.classList.add('hit');
    renderStats();
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && e.target === document.body) {
      e.preventDefault();
      orb.click();
    }
    if (e.key === 'Escape') hideRelease();
  });

  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest && e.target.closest('.card');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  $('#release').addEventListener('click', hideRelease);
  $('#fightBtn').addEventListener('click', fight);

  $('#zanBody').addEventListener('change', (e) => {
    const i = e.target.closest('input[data-custom]');
    if (!i || !has(S.custom, i.dataset.custom)) return;
    const max = i.dataset.custom === 'cmd' ? 48 : 30;
    S.custom[i.dataset.custom] = cleanText(i.value, max);
    save();
    renderZan();
    toast('Nom enregistré.', 'good');
  });
  $('#zanBody').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[data-custom]')) e.target.blur();
  });

  $('#zanBody').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.aff) chooseAffinity(b.dataset.aff);
    else if (b.dataset.form) setForm(b.dataset.form);
    else if (b.dataset.trial) trial(b.dataset.trial);
    else if (b.dataset.replay) showRelease(b.dataset.replay);
    else if (b.dataset.resetnames) { S.custom = { shikai: '', cmd: '', bankai: '' }; save(); renderZan(); toast('Noms d’origine rétablis.'); }
  });

  const nameEl = $('#name');
  nameEl.addEventListener('input', () => { S.name = nameEl.value.replace(/[<>]/g, '').slice(0, 20); });
  nameEl.addEventListener('blur', () => { S.name = S.name.trim() || 'Shinigami'; nameEl.value = S.name; save(); });
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameEl.blur(); });

  // Sauvegarde : fichier
  $('#expBtn').addEventListener('click', () => {
    const ex = buildExport();
    const blob = new Blob([JSON.stringify(ex, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const slug = S.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ame';
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const a = h('a', { href: url, download: `soul-forge-${slug}-niv${S.level}-${day}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Sauvegarde téléchargée.', 'good');
  });

  $('#impBtn').addEventListener('click', () => $('#impFile').click());
  $('#impFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 200 * 1024) { toast('Fichier trop volumineux.', 'bad'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try { importParsed(JSON.parse(String(reader.result))); }
      catch { toast('Fichier illisible.', 'bad'); }
    };
    reader.onerror = () => toast('Lecture du fichier impossible.', 'bad');
    reader.readAsText(file);
  });

  // Sauvegarde : code
  $('#codeBtn').addEventListener('click', async () => {
    const code = toCode();
    const area = $('#codeArea');
    area.value = code;
    try {
      await navigator.clipboard.writeText(code);
      toast('Code copié dans le presse-papiers.', 'good');
    } catch {
      area.select();
      toast('Code généré : copie-le depuis la zone de texte.');
    }
  });
  $('#codeLoadBtn').addEventListener('click', () => {
    const raw = $('#codeArea').value.trim();
    if (!raw.startsWith('SF1.')) { toast('Code invalide (il doit commencer par SF1.).', 'bad'); return; }
    try { importParsed(JSON.parse(b64d(raw.slice(4)))); }
    catch { toast('Code illisible.', 'bad'); }
  });

  // Sauvegarde : Discord (via le serveur, le webhook n'est jamais exposé au navigateur)
  const DC_KEY = 'soulforge.discord.last';
  const dcSend = $('#dcSendBtn'), dcLoad = $('#dcLoadBtn'), dcCode = $('#dcCode');

  async function api(path, body) {
    let r;
    try {
      r = await fetch(path, body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : undefined);
    } catch { throw new Error('Serveur injoignable.'); }
    let j = null;
    try { j = await r.json(); } catch { /* réponse non JSON */ }
    if (!r.ok) throw new Error((j && j.error) || 'Erreur serveur.');
    return j;
  }

  try { dcCode.value = localStorage.getItem(DC_KEY) || ''; } catch { /* ignore */ }

  api('/api/backup/status').then((s) => {
    if (s && s.enabled) { dcSend.disabled = false; dcLoad.disabled = false; return; }
    throw new Error('off');
  }).catch(() => {
    $('#discordBox').classList.add('off');
    $('#discordInfo').textContent = 'La sauvegarde Discord n’est pas activée sur ce serveur. Utilise le fichier ou le code ci-dessus.';
  });

  dcSend.addEventListener('click', async () => {
    dcSend.disabled = true;
    try {
      const { code } = await api('/api/backup', buildExport());
      dcCode.value = code;
      try { localStorage.setItem(DC_KEY, code); } catch { /* ignore */ }
      let copied = false;
      try { await navigator.clipboard.writeText(code); copied = true; } catch { dcCode.select(); }
      toast(copied ? 'Envoyé sur Discord · code copié, garde-le !' : 'Envoyé sur Discord · copie ton code.', 'good');
    } catch (e) { toast(e.message, 'bad'); }
    dcSend.disabled = false;
  });

  dcLoad.addEventListener('click', async () => {
    const code = dcCode.value.trim();
    if (!/^SFD-\d{5,25}-[0-9a-f]{16}$/.test(code)) { toast('Code invalide (il doit ressembler à SFD-…).', 'bad'); return; }
    dcLoad.disabled = true;
    try {
      const { backup } = await api('/api/backup/restore', { code });
      try { localStorage.setItem(DC_KEY, code); } catch { /* ignore */ }
      importParsed(backup); // vérifie la somme de contrôle et demande confirmation
    } catch (e) { toast(e.message, 'bad'); }
    dcLoad.disabled = false;
  });

  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Réinitialiser toute ta progression ?\nPense à télécharger ta sauvegarde avant : cette action est définitive.')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    S = defaultState();
    logs.length = 0;
    enemy = makeEnemy();
    renderAll();
    save();
    toast('Progression réinitialisée.');
  });

  /* ═════════ Démarrage ═════════ */
  (function offlineProgress() {
    const secs = Math.min((Date.now() - S.updated) / 1000, 8 * 3600);
    const ps = perSec();
    if (secs > 60 && ps > 0) {
      const gain = Math.floor(ps * secs * 0.5);
      S.reiatsu += gain;
      setTimeout(() => toast(`Pendant ton absence, ton âme a médité : +${fmt(gain)} reiatsu.`, 'good'), 600);
    }
  })();

  enemy = makeEnemy();
  renderAll();
  save();

  setInterval(() => {
    const ps = perSec();
    if (ps > 0) { S.reiatsu += ps; gainXP(ps * 0.2); renderStats(); }
  }, 1000);
  setInterval(save, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
})();
