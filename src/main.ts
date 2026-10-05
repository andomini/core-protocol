import Phaser from 'phaser';

// M0 placeholder: proves the Phaser build works. Replaced by the real scenes in M2.
class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const r = 48;
    const points: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      points.push(new Phaser.Math.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    this.add.graphics().lineStyle(4, 0x22e5ff, 1).strokePoints(points, true);
    this.add
      .text(cx, cy + 90, 'CORE PROTOCOL', { fontFamily: 'monospace', fontSize: '32px', color: '#22e5ff' })
      .setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#070b1a',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [TitleScene],
});
