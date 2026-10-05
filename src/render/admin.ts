// Dev admin panel (dev server only; never in portal or Pages builds): F2 or the DEV button.
// Wave jumps, speeds up to ×50, resources, god mode, protocol/stat cheats, meta unlocks, save reset.
import type Phaser from 'phaser';
import { CARDS } from '../meta/cards';
import { DEFAULT_META_DATA } from '../meta/metaData';
import { META_KEY, RUN_KEY } from '../meta/MetaStore';
import { services } from '../services';
import { DEFAULT_DATA, STAT_IDS } from '../sim/data';
import type { BattleScene } from './scenes/BattleScene';

const CSS = `
#cp-admin-btn{position:fixed;left:6px;top:6px;z-index:10000;font:700 12px monospace;color:#22e5ff;background:#0a1230e6;border:1px solid #22e5ff;border-radius:6px;padding:4px 8px;cursor:pointer}
#cp-admin{position:fixed;left:6px;top:36px;z-index:10000;width:290px;max-height:calc(100vh - 48px);overflow:auto;font:12px/1.35 monospace;color:#e8fbff;background:#070b1af2;border:1px solid #22e5ff;border-radius:8px;padding:8px;box-shadow:0 0 18px #22e5ff55;display:none}
#cp-admin h4{margin:8px 0 4px;color:#22e5ff;font-size:12px;letter-spacing:1px}
#cp-admin button{font:700 11px monospace;color:#e8fbff;background:#0f1d45;border:1px solid #2f5bb0;border-radius:4px;padding:4px 6px;margin:2px;cursor:pointer}
#cp-admin button:hover{border-color:#22e5ff}
#cp-admin button.on{background:#22e5ff;color:#03050d}
#cp-admin input{width:56px;font:11px monospace;background:#0a1230;color:#e8fbff;border:1px solid #2f5bb0;border-radius:4px;padding:3px}
#cp-admin .info{color:#7f97c8;white-space:pre}
`;

export function installAdmin(game: Phaser.Game): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const btn = document.createElement('div');
  btn.id = 'cp-admin-btn';
  btn.textContent = 'DEV';
  const panel = document.createElement('div');
  panel.id = 'cp-admin';
  document.body.append(btn, panel);
  // The panel must not count as game input (no portal gameplayStart, no canvas taps through it).
  for (const el of [btn, panel]) el.addEventListener('pointerdown', (e) => e.stopPropagation());

  const battle = (): BattleScene | null => {
    const s = game.scene.getScene('Battle') as unknown as BattleScene | null;
    return s && s.sys.isActive() ? s : null;
  };
  const meta = () => services.meta.meta;
  const saveMeta = () => {
    services.meta.save();
    const home = game.scene.getScene('Home') as unknown as { refresh?: () => void } | null;
    if (game.scene.isActive('Home')) home?.refresh?.();
  };
  const goto = (key: 'Home' | 'Battle', data?: object) => {
    for (const s of game.scene.getScenes(true)) if (s.sys.settings.key !== 'Boot') s.scene.start(key, data);
  };

  type Item = [label: string, fn: () => void, active?: () => boolean];
  const sections: [string, Item[]][] = [
    ['SPEED', [1, 2, 5, 10, 20, 50].map((n): Item => [`×${n}`, () => {
      const b = battle();
      if (!b) return;
      b.devMaxSpeed = 50;
      b.setSpeed(n);
    }, () => battle()?.speed === n])],
    ['WAVES', [
      ['+1 wave', () => { const b = battle(); if (b) b.devJumpWave(b.session.world.wave + 1); }],
      ['+5', () => { const b = battle(); if (b) b.devJumpWave(b.session.world.wave + 5); }],
      ['+10', () => { const b = battle(); if (b) b.devJumpWave(b.session.world.wave + 10); }],
      ['kill all', () => battle()?.devKillAll()],
      ['spawn boss', () => battle()?.spawn('boss', 1)],
      ['spawn 30', () => battle()?.spawn('basic', 30)],
      ['pick now', () => battle()?.devPickNow()],
      ['auto pick', () => { const b = battle(); if (b) b.devAutoPick = !b.devAutoPick; }, () => battle()?.devAutoPick === true],
    ]],
    ['CORE', [
      ['god mode', () => { const b = battle(); if (b) b.devGod = !b.devGod; }, () => battle()?.devGod === true],
      ['heal', () => { const b = battle(); if (b) b.session.world.core.hp = b.session.stats.health; }],
      ['+10 levels all', () => battle()?.devLevels(10)],
      ['pause', () => { const b = battle(); if (b) b.setPaused(!b.paused); }, () => battle()?.paused === true],
      ['die', () => battle()?.devDie()],
    ]],
    ['RESOURCES', [
      ['+1K ⚡', () => { const b = battle(); if (b) b.session.world.energy += 1e3; }],
      ['+1M ⚡', () => { const b = battle(); if (b) b.session.world.energy += 1e6; }],
      ['+1K ◆', () => { meta().bits += 1e3; saveMeta(); }],
      ['+100K ◆', () => { meta().bits += 1e5; saveMeta(); }],
      ['+50 keys', () => { meta().keys += 50; saveMeta(); }],
    ]],
    ['META', [
      ['all labs', () => { meta().labs = DEFAULT_META_DATA.labs.nodes.map((n) => n.id); saveMeta(); }],
      ['all cards ★5', () => { for (const c of CARDS.cards) meta().cards[c.id] = CARDS.stars[4]!; meta().firstRunDone = true; meta().starterGiven = true; saveMeta(); }],
      ['all tiers', () => { meta().tierUnlocked = DEFAULT_DATA.tiers.length; meta().firstRunDone = true; saveMeta(); }],
      ['workshop +10', () => { for (const id of STAT_IDS) meta().workshop[id] = (meta().workshop[id] ?? 0) + 10; saveMeta(); }],
      ['reset save', () => {
        if (!confirm('Reset all progress?')) return;
        services.storage.removeItem(META_KEY);
        services.storage.removeItem(RUN_KEY);
        location.reload();
      }],
    ]],
    ['GO', [
      ['home', () => goto('Home')],
      ...[1, 2, 3, 4, 5, 6].map((t): Item => [`run T${t}`, () => goto('Battle', { mode: 'new', tier: t })]),
    ]],
  ];

  const info = document.createElement('div');
  info.className = 'info';
  const jump = document.createElement('div');
  jump.innerHTML = 'jump to wave <input id="cp-admin-wave" type="number" min="1" value="25"> ';
  const go = document.createElement('button');
  go.textContent = 'go';
  go.onclick = () => battle()?.devJumpWave(Number((document.getElementById('cp-admin-wave') as HTMLInputElement).value));
  jump.appendChild(go);
  panel.appendChild(info);
  const buttons: [HTMLButtonElement, Item][] = [];
  for (const [title, items] of sections) {
    const h = document.createElement('h4');
    h.textContent = title;
    panel.appendChild(h);
    if (title === 'WAVES') panel.appendChild(jump);
    for (const it of items) {
      const b = document.createElement('button');
      b.textContent = it[0];
      b.onclick = () => {
        it[1]();
        refresh();
      };
      panel.appendChild(b);
      buttons.push([b, it]);
    }
  }
  const refresh = () => {
    for (const [b, it] of buttons) b.classList.toggle('on', it[2]?.() === true);
    const bs = battle();
    const w = bs?.session.world;
    info.textContent = w
      ? `wave ${w.wave} · tick ${w.tick} · ${w.phase}\nenemies ${w.enemies.length} · ×${bs!.speed} · fps ${Math.round(bs!.avgFps())}\n⚡ ${Math.floor(w.energy)} · core ${Math.ceil(w.core.hp)}/${Math.ceil(bs!.session.stats.health)}`
      : `scene: Home · ◆ ${Math.floor(meta().bits)} · keys ${meta().keys}`;
  };
  const toggle = () => {
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    refresh();
  };
  btn.onclick = toggle;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      toggle();
    }
  });
  setInterval(() => panel.style.display === 'block' && refresh(), 300);
}
