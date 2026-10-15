// A small DOM toast over the canvas ("No ad right now"). Plain DOM so any scene can use it; it never
// takes input. Colours from the palette tokens.
import { BG_CSS, CYAN_CSS, TEXT, TEXT_DIM } from '../render/palette';

let el: HTMLDivElement | null = null;
let timer = 0;

/**
 * `at` = CSS-px centre for the toast (e.g. inside the arena); defaults to the viewport centre-ish.
 * `tone` 'dim' = a quiet grey variant (a bonus going offline), no glow.
 */
export function showToast(text: string, ms: number, at?: { x: number; y: number } | null, tone: 'info' | 'dim' = 'info'): void {
  if (typeof document === 'undefined') return;
  if (!el) {
    el = document.createElement('div');
    el.id = 'cp-toast';
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);max-width:92vw;z-index:9000;pointer-events:none;' +
      `padding:12px 22px;border:2px solid;background:${BG_CSS}e6;` +
      'font:700 clamp(16px,2.6vmin + 6px,26px) "Chakra Petch",sans-serif;letter-spacing:.06em;' +
      // Shrink-wraps one line, but a long list (several bonuses offline) wraps inside 92vw instead of running off.
      'width:max-content;box-sizing:border-box;text-align:center;white-space:normal;' +
      'transition:opacity .25s;opacity:0';
    document.body.append(el);
  }
  const c = tone === 'dim' ? TEXT_DIM : CYAN_CSS;
  el.style.borderColor = c;
  el.style.color = tone === 'dim' ? TEXT_DIM : TEXT;
  el.style.boxShadow = tone === 'dim' ? 'none' : `0 0 18px ${c}88, inset 0 0 12px ${c}44`;
  el.dataset.tone = tone;
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
