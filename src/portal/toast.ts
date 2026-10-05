// A small DOM toast over the canvas ("No ad right now"). Plain DOM so any scene can use it; it never
// takes input. Colours from the palette tokens.
import { BG_CSS, CYAN_CSS, TEXT } from '../render/palette';

let el: HTMLDivElement | null = null;
let timer = 0;

/** `at` = CSS-px centre for the toast (e.g. inside the arena); defaults to the viewport centre-ish. */
export function showToast(text: string, ms: number, at?: { x: number; y: number } | null): void {
  if (typeof document === 'undefined') return;
  if (!el) {
    el = document.createElement('div');
    el.id = 'cp-toast';
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);max-width:92vw;z-index:9000;pointer-events:none;' +
      `padding:12px 22px;border:2px solid ${CYAN_CSS};background:${BG_CSS}e6;color:${TEXT};` +
      'font:700 clamp(16px,2.6vmin + 6px,26px) "Chakra Petch",sans-serif;letter-spacing:.06em;white-space:nowrap;' +
      `box-shadow:0 0 18px ${CYAN_CSS}88, inset 0 0 12px ${CYAN_CSS}44;transition:opacity .25s;opacity:0`;
    document.body.append(el);
  }
  el.style.left = at ? `${at.x}px` : '50%';
  el.style.top = at ? `${at.y}px` : '38%';
  el.textContent = text;
  el.style.opacity = '1';
  el.dataset.shown = String((Number(el.dataset.shown) || 0) + 1);
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (el) el.style.opacity = '0';
  }, ms);
}
