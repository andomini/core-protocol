// A small DOM dialog over the canvas: a text field (or just a question) with OK / CANCEL. A real <input>
// brings up the phone keyboard and works inside portal iframes, where window.prompt() may be blocked.

export interface PromptOptions {
  title: string;
  /** Hint under the title (rules, errors). */
  hint?: string;
  /** Initial text; omit `input` (false) for a yes/no confirmation. */
  value?: string;
  input?: boolean;
  maxLength?: number;
  placeholder?: string;
  ok?: string;
  /** Danger styling for the OK button (delete). */
  danger?: boolean;
}

let open: HTMLElement | null = null;

/** Resolves with the entered text (trimmed), true-ish '' for a confirmed question, or null when cancelled. */
export function askText(o: PromptOptions): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  open?.remove();
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'cp-prompt';
    wrap.setAttribute('role', 'dialog');
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(2,4,12,.82);padding:16px;box-sizing:border-box;font-family:Rajdhani,system-ui,sans-serif;';
    const box = document.createElement('div');
    box.style.cssText =
      'width:min(420px,100%);background:#070d24;border:2px solid #22e5ff;box-shadow:0 0 18px rgba(34,229,255,.45);border-radius:10px;padding:18px;box-sizing:border-box;color:#e8fbff;';
    const h = document.createElement('div');
    h.textContent = o.title;
    h.style.cssText = 'font-size:20px;font-weight:800;letter-spacing:.06em;margin-bottom:8px;text-shadow:0 0 8px #22e5ff;';
    box.appendChild(h);
    if (o.hint) {
      const p = document.createElement('div');
      p.textContent = o.hint;
      p.className = 'cp-prompt-hint';
      p.style.cssText = 'font-size:16px;color:#7f97c8;margin-bottom:12px;';
      box.appendChild(p);
    }
    let field: HTMLInputElement | null = null;
    if (o.input !== false) {
      field = document.createElement('input');
      field.type = 'text';
      field.value = o.value ?? '';
      field.maxLength = o.maxLength ?? 40;
      field.placeholder = o.placeholder ?? '';
      field.autocomplete = 'off';
      field.spellcheck = false;
      // ≥16px: iOS zooms the page into smaller fields.
      field.style.cssText =
        'width:100%;box-sizing:border-box;font-size:18px;padding:10px 12px;background:#02040c;color:#e8fbff;border:1.5px solid #1f6bff;border-radius:6px;outline:none;margin-bottom:14px;font-family:inherit;';
      box.appendChild(field);
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;';
    const mk = (label: string, color: string, fill: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = `flex:1;font-size:18px;font-weight:800;padding:12px 0;letter-spacing:.06em;background:${fill};color:${color};border:2px solid ${color};border-radius:6px;cursor:pointer;font-family:inherit;`;
      row.appendChild(b);
      return b;
    };
    const cancel = mk('CANCEL', '#7f97c8', '#0a1230');
    const ok = mk(o.ok ?? 'OK', o.danger ? '#ff8a9b' : '#2bffb0', o.danger ? '#2a0610' : '#063a2a');
    ok.className = 'cp-prompt-ok';
    box.appendChild(row);
    wrap.appendChild(box);
    const done = (v: string | null) => {
      wrap.remove();
      if (open === wrap) open = null;
      resolve(v);
    };
    ok.onclick = () => done(field ? field.value.trim() : '');
    cancel.onclick = () => done(null);
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) done(null);
    });
    // Keys typed here must not reach the game's shortcuts.
    wrap.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') ok.click();
      if (e.key === 'Escape') done(null);
    });
    document.body.appendChild(wrap);
    open = wrap;
    (field ?? ok).focus();
  });
}

/** Copies text to the clipboard (async API, else a hidden textarea). Resolves false if both fail. */
export async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.style.cssText = 'position:fixed;left:-1000px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
