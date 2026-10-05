// Object pools: hot paths (enemies, tracers, glitch copies) never create or destroy game objects per frame.

import Phaser from 'phaser';

export class ImagePool {
  private readonly free: Phaser.GameObjects.Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly texture: string,
    private readonly depth: number,
    private readonly blend: Phaser.BlendModes = Phaser.BlendModes.ADD,
  ) {}

  get(texture = this.texture): Phaser.GameObjects.Image {
    const img = this.free.pop() ?? this.scene.add.image(0, 0, texture).setDepth(this.depth).setBlendMode(this.blend);
    if (img.texture.key !== texture) img.setTexture(texture);
    return img.setVisible(true).setAlpha(1).setRotation(0).setScale(1).clearTint();
  }

  release(img: Phaser.GameObjects.Image): void {
    img.setVisible(false);
    this.free.push(img);
  }
}
