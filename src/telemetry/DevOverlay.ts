// Telemetry overlay (from Last Tower): live tail + JSON export. Plain DOM, outside the canvas. Loaded as a
// lazy chunk only in DEV (toggle with ~) or with ?telemetry=1 in any build (playtests: open, export).
import type { Telemetry } from './Telemetry';

export function installDevOverlay(tm: Telemetry, openNow: boolean): void {
  let box: HTMLDivElement | null = null;
  const render = (): void => {
    const list = box?.querySelector('pre');
    if (!list) return;
    list.textContent = tm
      .all()
      .slice(-40)
      .map((e) => {
        const { t, type, sessionId: _s, build: _b, runId: _r, deviceId: _d, ...rest } = e;
        return `${new Date(t).toISOString().slice(11, 19)} ${type} ${JSON.stringify(rest)}`;
      })
      .join('\n');
  };
  const toggle = (): void => {
    if (box) {
      box.remove();
      box = null;
      return;
    }
    box = document.createElement('div');
    box.id = 'cp-telemetry';
    box.style.cssText =
      'position:fixed;inset:8px;z-index:9999;background:rgba(7,11,26,.94);color:#cfe;font:12px monospace;padding:8px;overflow:auto;border:1px solid #22e5ff;user-select:text;-webkit-user-select:text';
    const bar = document.createElement('div');
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'margin-right:8px;font:12px monospace';
      b.onclick = fn;
      bar.append(b);
    };
    btn(`Export ${tm.all().length} events`, () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([tm.exportJson()], { type: 'application/json' }));
      a.download = `telemetry-${tm.deviceId}-${tm.sessionId}.json`;
      a.click();
    });
    btn('Clear', () => {
      tm.clear();
      render();
    });
    btn('Close (~)', toggle);
    box.append(bar, document.createElement('pre'));
    document.body.appendChild(box);
    render();
  };
  tm.listeners.push(render);
  window.addEventListener('keydown', (e) => {
    if (e.key === '`' || e.key === '~') toggle();
  });
  if (openNow) toggle();
}
