/* config.js — tells the app where the API lives.
   This is the only file you edit after deploying the backend. */
(function (global) {
  'use strict';

  global.INKCADENCE_CONFIG = {
    /* The origin of the Inkcadence API, with no trailing slash.
       Leave it empty and the app runs entirely on the device — which is what the
       GitHub Pages build does until you point it somewhere.
       Examples:
         ''                          local only, no server
         'https://api.example.com'   your VPS
         'https://inkcadence.vercel.app'   Vercel */
    apiBase: '',

    /* 'auto' — use the API when apiBase is set and answers /api/health
       'off'  — never call the server, even if apiBase is set */
    remote: 'auto'
  };
})(window);
