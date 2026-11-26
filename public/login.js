'use strict';
// Affiche l'erreur éventuelle renvoyée par /auth/callback (?e=...).
(() => {
  const MSG = {
    denied: 'Connexion annulée sur Discord.',
    state: 'Session de connexion expirée, réessaie.',
    discord: 'Discord a refusé ou n’a pas répondu. Réessaie dans un instant.',
    rate: 'Trop de tentatives, patiente quelques minutes.',
  };
  const code = new URLSearchParams(location.search).get('e');
  if (code && Object.prototype.hasOwnProperty.call(MSG, code)) {
    const el = document.getElementById('err');
    el.textContent = MSG[code];
    el.hidden = false;
  }
})();
