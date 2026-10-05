// Fake CrazyGames SDK v3 for the UI smoke (dev server via addInitScript, production builds via page.route).
// Records every call in window.__sdkLog. Ads: adStarted after 300 ms, adFinished 1.5 s later, unless
// window.__fakeAdMode is 'fail' (adError after 150 ms). Shows a DOM "ad" so screenshots show it.
(() => {
  const log = (window.__sdkLog = window.__sdkLog || []);
  const rec = (name) => log.push({ t: Math.round(performance.now()), name });
  const data = new Map();
  const listeners = [];
  const overlay = (on) => {
    let el = document.getElementById('fake-sdk-ad');
    if (!on) return el && el.remove();
    el = document.createElement('div');
    el.id = 'fake-sdk-ad';
    el.textContent = 'CrazyGames SDK ad (fake)';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#111c;color:#fff;font:700 28px sans-serif';
    document.body.append(el);
  };
  window.CrazyGames = {
    SDK: {
      environment: 'crazygames',
      init: () => (rec('init'), new Promise((r) => setTimeout(r, 50))),
      game: {
        loadingStart: () => rec('loadingStart'),
        loadingStop: () => rec('loadingStop'),
        gameplayStart: () => rec('gameplayStart'),
        gameplayStop: () => rec('gameplayStop'),
        happytime: () => rec('happytime'),
        settings: { muteAudio: false },
        addSettingsChangeListener: (cb) => listeners.push(cb),
      },
      ad: {
        hasAdblock: async () => false,
        requestAd: (type, cb) => {
          rec(`requestAd:${type}`);
          if (window.__fakeAdMode === 'fail') {
            setTimeout(() => (rec('adError'), cb.adError?.({ code: 'unfilled', message: 'fake' })), 150);
            return;
          }
          setTimeout(() => {
            rec('adStarted');
            overlay(true);
            cb.adStarted?.();
            setTimeout(() => {
              rec('adFinished');
              overlay(false);
              cb.adFinished?.();
            }, 1500);
          }, 300);
        },
      },
      data: {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => void data.set(k, String(v)),
        removeItem: (k) => void data.delete(k),
        clear: () => data.clear(),
      },
    },
  };
})();
