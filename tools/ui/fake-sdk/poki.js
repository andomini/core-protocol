// Fake Poki SDK v2 for the UI smoke. Records calls in window.__sdkLog. commercialBreak/rewardedBreak call
// their onStart after 300 ms and settle 1.5 s later; window.__fakeAdMode = 'fail' settles with no ad.
(() => {
  const log = (window.__sdkLog = window.__sdkLog || []);
  const rec = (name) => log.push({ t: Math.round(performance.now()), name });
  const brk = (name, result) => (onStart) => {
    rec(name);
    if (window.__fakeAdMode === 'fail') return new Promise((r) => setTimeout(() => (rec('adError'), r(name === 'rewardedBreak' ? false : undefined)), 150));
    return new Promise((r) =>
      setTimeout(() => {
        rec('adStarted');
        onStart?.();
        setTimeout(() => (rec('adFinished'), r(result)), 1500);
      }, 300),
    );
  };
  window.PokiSDK = {
    init: () => (rec('init'), new Promise((r) => setTimeout(r, 50))),
    gameLoadingFinished: () => rec('gameLoadingFinished'),
    gameplayStart: () => rec('gameplayStart'),
    gameplayStop: () => rec('gameplayStop'),
    commercialBreak: brk('commercialBreak', undefined),
    rewardedBreak: brk('rewardedBreak', true),
  };
})();
