'use strict';
// Sauvegardes de la base du serveur (joueurs, rôles, bans, réglages, journal).
// Instantanés JSON dans DATA_DIR/backups, avec somme de contrôle. Rotation par type.
// Attention : sans Volume Railway, ce dossier est effacé à chaque redéploiement ;
// télécharge alors régulièrement une sauvegarde depuis le panel.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KIND = { auto: 'auto', manual: 'manuelle', 'pre-restore': 'avant-restauration' };
const KEEP = { auto: 7, manual: 20, 'pre-restore': 5 };
const NAME_RE = /^db-(\d{8}-\d{6})-(auto|manual|pre-restore)(?:-\d+)?\.json$/;
const FORMAT = 'soul-forge-db';
const DAY = 864e5;

const sum = (data) => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
const stamp = (d) => d.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

function createBackups({ store }) {
  const dir = path.join(store.dir, 'backups');

  function summary(data) {
    const users = Object.values(data.users || {}).filter((u) => u && !u.stub);
    return { users: users.length, audit: (data.audit || []).length };
  }

  function list() {
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; }
    const out = [];
    for (const name of names) {
      const m = NAME_RE.exec(name);
      if (!m) continue;
      try {
        const st = fs.statSync(path.join(dir, name));
        out.push({ name, kind: m[2], size: st.size, at: st.mtimeMs });
      } catch { /* fichier disparu entre-temps */ }
    }
    return out.sort((a, b) => b.at - a.at);
  }

  function prune(kind) {
    const old = list().filter((b) => b.kind === kind).slice(KEEP[kind]);
    for (const b of old) { try { fs.unlinkSync(path.join(dir, b.name)); } catch { /* ignore */ } }
  }

  function create(kind, actor) {
    if (!KEEP[kind]) throw new Error('Type de sauvegarde inconnu.');
    store.flush();
    const now = new Date();
    const data = JSON.parse(JSON.stringify(store.db));
    const doc = { format: FORMAT, v: 1, createdAt: now.toISOString(), kind, by: actor || null, summary: summary(data), checksum: sum(data), data };
    fs.mkdirSync(dir, { recursive: true });
    let name = `db-${stamp(now)}-${kind}.json`;
    for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `db-${stamp(now)}-${kind}-${i}.json`;
    const file = path.join(dir, name);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, file);
    prune(kind);
    return { name, kind, size: fs.statSync(file).size, at: now.getTime() };
  }

  // Vérifie un document de sauvegarde (fichier du disque ou envoyé par le fondateur).
  function validate(doc) {
    const bad = (m) => Object.assign(new Error(m), { status: 400 });
    if (!doc || typeof doc !== 'object' || doc.format !== FORMAT) throw bad('Ce fichier n’est pas une sauvegarde Soul Forge (base).');
    const d = doc.data;
    if (!d || typeof d !== 'object' || !d.users || typeof d.users !== 'object' || Array.isArray(d.users)) throw bad('Sauvegarde illisible : joueurs manquants.');
    if (doc.checksum !== sum(d)) throw bad('Somme de contrôle invalide : fichier modifié ou abîmé.');
    return d;
  }

  function read(name) {
    if (!NAME_RE.test(String(name))) throw Object.assign(new Error('Nom de sauvegarde invalide.'), { status: 400 });
    let raw;
    try { raw = fs.readFileSync(path.join(dir, name), 'utf8'); }
    catch { throw Object.assign(new Error('Sauvegarde introuvable.'), { status: 404 }); }
    try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Sauvegarde abîmée.'), { status: 500 }); }
  }

  function remove(name) {
    if (!NAME_RE.test(String(name))) throw Object.assign(new Error('Nom de sauvegarde invalide.'), { status: 400 });
    try { fs.unlinkSync(path.join(dir, name)); } catch { throw Object.assign(new Error('Sauvegarde introuvable.'), { status: 404 }); }
  }

  // Restaure : sécurité d'abord (instantané « avant-restauration »), puis remplacement complet.
  function restore(doc, actor) {
    const data = validate(doc);
    const safety = create('pre-restore', actor);
    store.replace(data);
    return { safety: safety.name, summary: summary(store.db) };
  }

  // Une sauvegarde automatique par jour (vérifiée toutes les heures).
  function startAuto(log = console) {
    const tick = () => {
      try {
        const last = list().find((b) => b.kind === 'auto');
        if (!last || Date.now() - last.at >= DAY) create('auto', null);
      } catch (e) { log.error('Sauvegarde automatique impossible :', e.message); }
    };
    setTimeout(tick, 15e3).unref();
    setInterval(tick, 3600e3).unref();
  }

  return { dir, list, create, read, remove, validate, restore, startAuto, KIND, FORMAT };
}

module.exports = { createBackups };
