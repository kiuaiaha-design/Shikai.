'use strict';
// Petite base JSON (sans dépendance) : joueurs, réglages, journal d'audit.
// Écriture différée + atomique. Sur Railway, monte un Volume pour qu'elle survive aux redéploiements.
const fs = require('fs');
const path = require('path');

function fresh() {
  return {
    v: 1,
    users: {},
    settings: { maintenance: { on: false, message: '' }, announcement: null },
    audit: [],
    stats: { logins: 0, backups: 0, restores: 0 },
  };
}

function createStore(dir) {
  const file = path.join(dir, 'db.json');
  let db = fresh();
  let persistent = true;

  function normalize(j) {
    const f = fresh();
    return {
      ...f, ...j,
      users: j.users && typeof j.users === 'object' && !Array.isArray(j.users) ? j.users : {},
      settings: { ...f.settings, ...(j.settings || {}) },
      stats: { ...f.stats, ...(j.stats || {}) },
      audit: Array.isArray(j.audit) ? j.audit : [],
    };
  }

  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* sera détecté à l'écriture */ }
  try {
    db = normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('Base illisible, copie en .corrupt et nouveau départ :', e.message);
      try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* ignore */ }
    }
  }

  let timer = null;
  let dirty = false;
  function flush() {
    clearTimeout(timer); timer = null;
    if (!dirty) return;
    dirty = false;
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, file);
      persistent = true;
    } catch (e) {
      persistent = false;
      console.error('Écriture de la base impossible :', e.message);
    }
  }
  function touch() {
    dirty = true;
    if (!timer) { timer = setTimeout(flush, 400); timer.unref(); }
  }
  function audit(actor, action, target, detail) {
    db.audit.push({ t: Date.now(), actor, action, target: target || null, detail: detail || null });
    if (db.audit.length > 300) db.audit.splice(0, db.audit.length - 300);
    touch();
  }

  // Remplace toute la base (restauration) et l'écrit tout de suite.
  function replace(next) {
    db = normalize(next);
    dirty = true;
    flush();
  }

  return { get db() { return db; }, touch, flush, audit, replace, get persistent() { return persistent; }, file, dir };
}

module.exports = { createStore };
