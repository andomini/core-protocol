// RANKS: online leaderboards (Tier all-time / Daily challenge / Weekly season), Global or Friends, my row
// pinned, a VERIFYING tag on runs the server has not replayed yet, the profile (name, friend code) and the
// list of players I follow (with UNFOLLOW).
// Everything degrades to a one-line status when the server is unreachable.

import Phaser from 'phaser';
import { BITS_CSS, CYAN, PANEL_FILL, TEXT, TEXT_DIM } from '../render/palette';
import { DEPTH } from '../render/WorldView';
import { dailyLoadout, dayKey, weekKey } from '../meta/leaderboardRules';
import type { Board, BoardKind, BoardScope, Friend, Leaderboard, LbResult } from '../portal/leaderboard';
import { nameError } from '../portal/leaderboard';
import { showToast } from '../portal/toast';
import { formatNum } from './format';
import { Button, panel, text } from './kit';
import type { Layout, Rect } from './layout';
import { askText, copyText } from './textPrompt';

const D = DEPTH.overlay + 2;
const KINDS: { id: BoardKind; label: string }[] = [
  { id: 'tier', label: 'TIER' },
  { id: 'daily', label: 'DAILY' },
  { id: 'weekly', label: 'WEEKLY' },
];
const ERR: Record<string, string> = {
  offline: 'Offline · leaderboards need a connection',
  unavailable: 'Leaderboards are unavailable right now',
  disabled: 'Leaderboards are off in this build',
  auth: 'Could not sign in to the leaderboards',
};

export interface LeaderboardPanelOpts {
  /** Highest tier the player can pick (tier / weekly boards). */
  maxTier: number;
  close(): void;
}

export class LeaderboardPanel {
  visible = false;
  kind: BoardKind = 'tier';
  scope: BoardScope = 'global';
  tier = 1;
  /** The last board shown (UI smoke). */
  board: Board | null = null;
  /** 'friends': the list of players I follow replaces the board. */
  view: 'board' | 'friends' = 'board';
  friends: Friend[] | null = null;
  status = '';
  private readonly fixed: Phaser.GameObjects.GameObject[] = [];
  private readonly blocker: Phaser.GameObjects.Zone;
  private readonly card: Rect;
  private objs: Phaser.GameObjects.GameObject[] = [];
  private buttons: Button[] = [];
  private gen = 0;
  private unsub: (() => void) | null = null;
  /** Named rects of the live buttons (UI smoke taps them). */
  rects: Record<string, Rect> = {};

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly L: Layout,
    private readonly lb: Leaderboard,
    private readonly o: LeaderboardPanelOpts,
  ) {
    const portrait = L.o === 'portrait';
    const dim = scene.add.graphics().setDepth(D);
    dim.fillStyle(0x02040c, 0.88).fillRect(0, 0, L.w, L.h);
    this.blocker = scene.add.zone(L.w / 2, L.h / 2, L.w, L.h).setDepth(D).setInteractive();
    const cw = portrait ? 690 : 1200;
    const ch = portrait ? L.h - 60 : 680;
    this.card = { x: (L.w - cw) / 2, y: (L.h - ch) / 2, w: cw, h: ch };
    const frame = panel(scene, this.card, D + 0.1, { edge: CYAN, fill: PANEL_FILL, fillA: 0.97, cut: 22, blur: 14, lw: 2.5 });
    const title = text(scene, L.w / 2, this.card.y + (portrait ? 40 : 30), 'RANKS', portrait ? 40 : 30, { font: 'title', weight: '900', glow: '#22e5ff', blur: 14 })
      .setOrigin(0.5)
      .setDepth(D + 0.3);
    this.fixed.push(dim, frame, title);
    this.hide();
  }

  show(tier: number): void {
    this.tier = Math.max(1, Math.min(this.o.maxTier, tier));
    this.visible = true;
    for (const o of this.fixed) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(true);
    this.blocker.setInteractive();
    this.unsub?.();
    this.unsub = this.lb.onChange(() => this.visible && this.render());
    this.reload();
    // First open: register (if not yet), then fill in the profile.
    void this.lb.ensurePlayer().then(() => this.visible && this.render());
  }

  hide(): void {
    this.visible = false;
    this.gen += 1;
    this.unsub?.();
    this.unsub = null;
    for (const o of this.fixed) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    this.blocker.disableInteractive();
    this.clear();
  }

  private clear(): void {
    for (const o of this.objs) o.destroy();
    for (const b of this.buttons) b.destroy();
    this.objs = [];
    this.buttons = [];
    this.rects = {};
  }

  private t(x: number, y: number, s: string, color = TEXT, o: { size?: number; title?: boolean } = {}): Phaser.GameObjects.Text {
    const obj = text(this.scene, x, y, s, o.size ?? this.L.minFont, { color, font: o.title ? 'title' : 'ui', weight: o.title ? '800' : '700' }).setDepth(D + 0.3);
    this.objs.push(obj);
    return obj;
  }

  private b(id: string, r: Rect, label: string, onClick: () => void, st: { on?: boolean; color?: string; edge?: number; enabled?: boolean } = {}): Button {
    const b = new Button(this.scene, r, label, this.L.minFont, D + 0.5, onClick, { font: 'title', cut: 10, blur: 8, fill: 0x062a3a, edge: st.edge ?? CYAN, textColor: st.color });
    if (st.on !== undefined) {
      b.label.setColor(st.on ? '#22e5ff' : TEXT_DIM);
      b.bg.setAlpha(st.on ? 1 : 0.45);
    }
    if (st.enabled === false) {
      b.bg.setAlpha(0.3);
      b.label.setAlpha(0.4);
      b.zone.disableInteractive();
    }
    this.buttons.push(b);
    this.rects[id] = r;
    return b;
  }

  private reload(): void {
    if (this.view === 'friends') return this.loadFriends();
    const gen = ++this.gen;
    this.board = null;
    this.status = 'Loading…';
    this.render();
    const arg = this.kind === 'daily' ? null : this.tier;
    void this.lb.board(this.kind, arg, this.scope, this.rowsFit()).then((r: LbResult<Board>) => {
      if (gen !== this.gen || !this.visible) return;
      if (r.ok) {
        this.board = r.data;
        this.status = r.data.entries.length ? '' : this.scope === 'friends' ? 'No friends on this board yet · share your code' : 'No runs on this board yet · be the first';
      } else this.status = ERR[r.error] ?? `Leaderboards: ${r.error}`;
      this.render();
    });
  }

  /** Rows that fit the list area (the board is fetched with this limit, so no scrolling is needed). */
  private rowsFit(): number {
    const g = this.geom();
    return Math.max(3, Math.floor(g.list.h / g.rowH) - 1);
  }

  private geom() {
    const portrait = this.L.o === 'portrait';
    const c = this.card;
    const f = this.L.minFont;
    const pad = 24;
    const bh = portrait ? 66 : 42;
    if (portrait) {
      const profileH = 2 * (bh + 12) + bh + 18; // name row, code row, add / close row
      const list: Rect = { x: c.x + pad, y: c.y + 78 + 2 * (bh + 12) + f + 26, w: c.w - 2 * pad, h: 0 };
      list.h = c.y + c.h - 18 - profileH - 18 - list.y;
      const profile: Rect = { x: c.x + pad, y: c.y + c.h - 18 - profileH, w: c.w - 2 * pad, h: profileH };
      return { portrait, f, bh, list, profile, rowH: f + 18, top: c.y + 78, left: { x: c.x + pad, w: c.w - 2 * pad } };
    }
    const lw = 760;
    const top = c.y + 62;
    const list: Rect = { x: c.x + pad, y: top + 2 * (bh + 10) + f + 18, w: lw, h: 0 };
    list.h = c.y + c.h - 24 - list.y;
    const profile: Rect = { x: c.x + pad + lw + 32, y: top, w: c.w - 2 * pad - lw - 32, h: c.h - 24 - (top - c.y) };
    return { portrait, f, bh, list, profile, rowH: f + 12, top, left: { x: c.x + pad, w: lw } };
  }

  private render(): void {
    if (!this.visible) return;
    this.clear();
    const g = this.geom();
    const { bh } = g;
    // Board kind tabs.
    const tw = (g.left.w - 2 * 10) / 3;
    KINDS.forEach((k, i) => {
      this.b(`kind:${k.id}`, { x: g.left.x + i * (tw + 10), y: g.top, w: tw, h: bh }, k.label, () => this.setKind(k.id), { on: this.kind === k.id });
    });
    // Scope toggle, and the tier picker (tier / weekly boards).
    const y2 = g.top + bh + (g.portrait ? 12 : 10);
    const sw = g.portrait ? 160 : 130;
    this.b('scope:global', { x: g.left.x, y: y2, w: sw, h: bh }, 'GLOBAL', () => this.setScope('global'), { on: this.scope === 'global' });
    this.b('scope:friends', { x: g.left.x + sw + 10, y: y2, w: sw, h: bh }, 'FRIENDS', () => this.setScope('friends'), { on: this.scope === 'friends' });
    const right = g.left.x + g.left.w;
    if (this.kind !== 'daily') {
      const aw = g.portrait ? 74 : 54;
      this.b('tier:next', { x: right - aw, y: y2, w: aw, h: bh }, '▶', () => this.setTier(this.tier + 1), { enabled: this.tier < this.o.maxTier });
      this.t(right - aw - 10, y2 + bh / 2, `TIER ${this.tier}`, TEXT, { title: true }).setOrigin(1, 0.5);
      const lx = right - aw - 10 - (g.portrait ? 132 : 90) - aw;
      this.b('tier:prev', { x: lx, y: y2, w: aw, h: bh }, '◀', () => this.setTier(this.tier - 1), { enabled: this.tier > 1 });
    }
    // Board line: what it ranks and when it resets.
    const now = Date.now();
    const bd = this.board;
    const info =
      this.kind === 'tier'
        ? `Best wave on tier ${this.tier} · all time`
        : this.kind === 'weekly'
          ? `Week of ${bd?.week ?? weekKey(now)} · ${left((bd?.endsAt ?? 0) - now)}`
          : `${bd?.day ?? dayKey(now)} · ${dailyLoadout(bd?.day ?? dayKey(now)).id.toUpperCase()} loadout · ${left((bd?.endsAt ?? 0) - now)}`;
    this.t(g.left.x, y2 + bh + 10, this.view === 'friends' ? 'Players you follow · their runs show on FRIENDS boards' : info, TEXT_DIM);
    if (this.view === 'friends') this.renderFriends(g);
    else this.renderList(g);
    this.renderProfile(g);
  }

  private loadFriends(): void {
    const gen = ++this.gen;
    this.friends = null;
    this.status = 'Loading…';
    this.render();
    void this.lb.friends().then((r) => {
      if (gen !== this.gen || !this.visible) return;
      if (r.ok) {
        this.friends = r.data.following;
        this.status = r.data.following.length ? '' : 'You follow nobody yet · ADD FRIEND with their code';
      } else this.status = ERR[r.error] ?? `Leaderboards: ${r.error}`;
      this.render();
    });
  }

  private renderFriends(g: ReturnType<LeaderboardPanel['geom']>): void {
    const { list, rowH, f } = g;
    const gr = this.scene.add.graphics().setDepth(D + 0.2);
    this.objs.push(gr);
    gr.lineStyle(2, CYAN, 0.5).lineBetween(list.x, list.y + f + 8, list.x + list.w, list.y + f + 8);
    const xCode = list.x + list.w - (g.portrait ? 200 : 170);
    this.t(list.x + 4, list.y, 'NAME', '#22e5ff', { title: true });
    this.t(xCode, list.y, 'CODE', '#22e5ff', { title: true }).setOrigin(1, 0);
    let y = list.y + f + 18;
    if (this.status) this.t(list.x + list.w / 2, y + rowH, this.status, TEXT_DIM).setOrigin(0.5, 0).setWordWrapWidth(list.w - 20).setAlign('center');
    const h = Math.max(rowH - 4, g.portrait ? 48 : 30);
    const maxRows = Math.max(0, Math.floor((list.y + list.h - y) / (h + 6)));
    const bw = g.portrait ? 180 : 150;
    (this.friends ?? []).slice(0, maxRows).forEach((fr, i) => {
      if (i % 2 === 1) gr.fillStyle(0x22e5ff, 0.05).fillRect(list.x - 6, y - 3, list.w + 12, h + 6);
      this.t(list.x + 4, y + h / 2, clip(fr.name, g.portrait ? 14 : 22) + (fr.badges > 0 ? ` ★${fr.badges}` : ''), TEXT).setOrigin(0, 0.5);
      this.t(xCode, y + h / 2, fmtCode(fr.friendCode), '#ffc93a').setOrigin(1, 0.5);
      this.b(`unfollow:${fr.friendCode}`, { x: list.x + list.w - bw, y, w: bw, h }, 'UNFOLLOW', () => void this.unfollow(fr), { color: '#ff6b8b', edge: 0xff6b8b });
      y += h + 6;
    });
    const more = (this.friends?.length ?? 0) - maxRows;
    if (more > 0) this.t(list.x + list.w / 2, y, `+${more} more`, TEXT_DIM).setOrigin(0.5, 0);
  }

  private toggleFriends(): void {
    this.view = this.view === 'friends' ? 'board' : 'friends';
    this.reload();
  }

  private async unfollow(fr: Friend): Promise<void> {
    const r = await this.lb.removeFriend(fr.friendCode);
    if (!r.ok) return showToast(ERR[r.error] ?? `Could not unfollow: ${r.error}`, 3000);
    showToast(`Unfollowed ${fr.name}`, 2500);
    if (this.visible && this.view === 'friends') this.reload();
  }

  private renderList(g: ReturnType<LeaderboardPanel['geom']>): void {
    const { list, rowH, f } = g;
    const xRank = list.x + 4;
    const xName = list.x + (g.portrait ? 96 : 80);
    const xWave = list.x + list.w - (g.portrait ? 170 : 150);
    const xTag = list.x + list.w - 4;
    const gr = this.scene.add.graphics().setDepth(D + 0.2);
    this.objs.push(gr);
    gr.lineStyle(2, CYAN, 0.5).lineBetween(list.x, list.y + f + 8, list.x + list.w, list.y + f + 8);
    this.t(xRank, list.y, '#', '#22e5ff', { title: true });
    this.t(xName, list.y, 'NAME', '#22e5ff', { title: true });
    this.t(xWave, list.y, 'WAVE', '#22e5ff', { title: true }).setOrigin(1, 0);
    let y = list.y + f + 18;
    const pending = this.lb.unverified().filter((o) => (this.kind === 'daily' ? o.kind === 'daily' : o.kind === 'tier' && o.tier === this.tier));
    if (this.status) {
      this.t(list.x + list.w / 2, y + rowH, this.status, TEXT_DIM).setOrigin(0.5, 0).setWordWrapWidth(list.w - 20).setAlign('center');
    }
    const bd = this.board;
    const maxRows = Math.max(0, Math.floor((list.y + list.h - y) / rowH) - 1);
    const row = (rank: string, name: string, wave: string, tag: string, me: boolean, i: number) => {
      if (me || i % 2 === 1) gr.fillStyle(me ? 0x2bffb0 : 0x22e5ff, me ? 0.14 : 0.05).fillRect(list.x - 6, y - 4, list.w + 12, rowH);
      const col = me ? '#2bffb0' : TEXT;
      this.t(xRank, y, rank, me ? '#2bffb0' : TEXT_DIM);
      this.t(xName, y, clip(name, g.portrait ? 16 : 22), col);
      this.t(xWave, y, wave, me ? '#2bffb0' : BITS_CSS).setOrigin(1, 0);
      if (tag) this.t(xTag, y, tag, '#ffb03b').setOrigin(1, 0);
      y += rowH;
    };
    if (bd) {
      bd.entries.slice(0, maxRows).forEach((e, i) => row(`${e.rank}`, e.name + (e.badges > 0 ? ` ★${e.badges}` : ''), formatNum(e.wave), e.status === 'verifying' ? 'VERIFYING' : '', !!e.me, i));
    }
    // My row, pinned under the list: the server's rank, or a local run still waiting to upload / verify.
    const pinY = list.y + list.h - rowH;
    gr.lineStyle(1.5, 0x2bffb0, 0.6).lineBetween(list.x, pinY - 6, list.x + list.w, pinY - 6);
    y = pinY;
    const me = bd?.me ?? null;
    const myName = this.lb.identity?.name ?? 'YOU';
    if (me) row(`${formatNum(me.rank)}`, `${myName} (you)`, formatNum(me.wave), me.status === 'verifying' ? 'VERIFYING' : '', true, 0);
    else if (pending.length) {
      const p = pending[pending.length - 1]!;
      row('—', `${myName} (you)`, formatNum(p.wave), p.state === 'queued' ? 'QUEUED' : 'VERIFYING', true, 0);
    } else row('—', `${myName} (you)`, '—', '', true, 0);
  }

  private renderProfile(g: ReturnType<LeaderboardPanel['geom']>): void {
    const p = g.profile;
    const { bh, f } = g;
    const id = this.lb.identity;
    const gap = 12;
    const bw = g.portrait ? 170 : p.w;
    if (g.portrait) {
      // Name · RENAME, code · COPY, then ADD FRIEND · CLOSE.
      const y1 = p.y;
      this.t(p.x, y1 + bh / 2, `NAME ${id?.name ?? '—'}`, TEXT).setOrigin(0, 0.5);
      this.b('rename', { x: p.x + p.w - bw, y: y1, w: bw, h: bh }, 'RENAME', () => void this.rename(), { enabled: !!id && !id.linked });
      const y2 = y1 + bh + gap;
      this.t(p.x, y2 + bh / 2, `CODE ${id ? fmtCode(id.friendCode) : '—'}`, '#ffc93a').setOrigin(0, 0.5);
      this.b('copy', { x: p.x + p.w - bw, y: y2, w: bw, h: bh }, 'COPY', () => void this.copy(), { enabled: !!id });
      const y3 = y2 + bh + gap + 6;
      const hw = (p.w - 2 * gap) / 3;
      this.b('add', { x: p.x, y: y3, w: hw, h: bh }, 'ADD FRIEND', () => void this.addFriend(), { enabled: !!id, color: '#2bffb0', edge: 0x2bffb0 });
      this.b('following', { x: p.x + hw + gap, y: y3, w: hw, h: bh }, this.view === 'friends' ? 'BOARD' : 'FOLLOWING', () => this.toggleFriends(), { enabled: !!id });
      this.b('close', { x: p.x + 2 * (hw + gap), y: y3, w: hw, h: bh }, 'CLOSE', () => this.o.close());
      return;
    }
    // Landscape: a profile column on the right.
    let y = p.y;
    this.t(p.x, y, 'YOUR PROFILE', '#22e5ff', { title: true });
    y += f + 14;
    this.t(p.x, y, id?.name ?? 'Not signed in', TEXT, { size: f + 4 });
    y += f + 16;
    this.b('rename', { x: p.x, y, w: p.w, h: bh }, id?.linked ? 'NAME FROM CRAZYGAMES' : 'RENAME', () => void this.rename(), { enabled: !!id && !id.linked });
    y += bh + 20;
    this.t(p.x, y, 'FRIEND CODE', TEXT_DIM);
    y += f + 8;
    this.t(p.x, y, id ? fmtCode(id.friendCode) : '—', '#ffc93a', { size: f + 10, title: true });
    y += f + 22;
    this.b('copy', { x: p.x, y, w: p.w, h: bh }, 'COPY CODE', () => void this.copy(), { enabled: !!id });
    y += bh + 10;
    this.b('add', { x: p.x, y, w: p.w, h: bh }, 'ADD FRIEND', () => void this.addFriend(), { enabled: !!id, color: '#2bffb0', edge: 0x2bffb0 });
    y += bh + 10;
    this.b('following', { x: p.x, y, w: p.w, h: bh }, this.view === 'friends' ? 'BACK TO BOARD' : 'FOLLOWING', () => this.toggleFriends(), { enabled: !!id });
    y += bh + 16;
    const q = this.lb.queued.length;
    if (q) this.t(p.x, y, `${q} run${q > 1 ? 's' : ''} waiting to upload`, '#ffb03b').setWordWrapWidth(p.w);
    this.b('close', { x: p.x, y: p.y + p.h - bh, w: p.w, h: bh }, 'CLOSE', () => this.o.close());
  }

  private setKind(k: BoardKind): void {
    if (this.kind === k && this.view === 'board') return;
    this.kind = k;
    this.view = 'board';
    this.reload();
  }

  private setScope(s: BoardScope): void {
    if (this.scope === s && this.view === 'board') return;
    this.scope = s;
    this.view = 'board';
    this.reload();
  }

  private setTier(t: number): void {
    const n = Math.max(1, Math.min(this.o.maxTier, t));
    if (n === this.tier) return;
    this.tier = n;
    this.reload();
  }

  private async rename(): Promise<void> {
    const id = this.lb.identity;
    if (!id) return;
    let hint = '3–20 characters: letters, digits, space _ . -';
    let value = id.name;
    for (;;) {
      const v = await askText({ title: 'YOUR NAME', hint, value, maxLength: 20, ok: 'SAVE' });
      if (v === null || v === id.name) return;
      const bad = nameError(v);
      if (bad) {
        hint = `Name: ${bad}`;
        value = v;
        continue;
      }
      const r = await this.lb.rename(v);
      if (r.ok) {
        showToast(`Name set: ${r.data.name}`, 2500);
        if (this.visible) this.reload();
        return;
      }
      if (r.error === 'name-profane') hint = 'That name is not allowed';
      else if (r.status === 0 || r.status >= 500) return showToast(ERR[r.error] ?? 'Leaderboards unavailable', 3000);
      else if (r.status === 429) return showToast('Too many renames · try later', 3000);
      else hint = `Name: ${r.error}`;
      value = v;
    }
  }

  private async copy(): Promise<void> {
    const id = this.lb.identity;
    if (!id) return;
    const ok = await copyText(id.friendCode);
    showToast(ok ? `Friend code ${fmtCode(id.friendCode)} copied` : `Your friend code: ${fmtCode(id.friendCode)}`, 3000);
  }

  private async addFriend(): Promise<void> {
    const v = await askText({ title: 'ADD FRIEND', hint: "Enter a friend's 6-character code", placeholder: 'ABC-123', maxLength: 9, ok: 'ADD' });
    if (!v) return;
    const r = await this.lb.addFriend(v);
    if (r.ok) {
      showToast(`Following ${r.data.friend.name}`, 2500);
      if (this.visible && (this.scope === 'friends' || this.view === 'friends')) this.reload();
      return;
    }
    const msg: Record<string, string> = {
      'bad-code': 'Codes are 6 letters / digits',
      'code-not-found': 'No player with that code',
      self: "That's your own code",
      'too-many-friends': 'Friend list is full',
    };
    showToast(msg[r.error] ?? ERR[r.error] ?? `Could not add: ${r.error}`, 3000);
  }
}

function fmtCode(c: string): string {
  return c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function left(ms: number): string {
  if (!(ms > 0)) return 'resets soon';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)}d left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}
