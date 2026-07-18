import Player from '../entities/Player.js';

export default class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    // no external assets; textures generated in create
  }

  create() {
    // generate simple textures (flat / vector style)
    const g = this.add.graphics();
    g.fillStyle(0x2ecc71, 1);
    g.fillRoundedRect(0, 0, 24, 48, 4);
    g.generateTexture('bottle', 24, 48);
    g.clear();

    g.fillStyle(0xe67e22, 1);
    g.fillCircle(12, 12, 12);
    g.generateTexture('alien', 24, 24);
    g.clear();

    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 6, 12);
    g.generateTexture('bullet', 6, 12);
    g.destroy();

    this.bullets = this.physics.add.group();
    this.enemies = this.physics.add.group();

    this.stateText = this.add.text(10, 10, '', { font: '16px sans-serif', fill: '#ffffff' }).setDepth(10);

    this.player = new Player(this, 400, 520);

    // input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyShoot = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyToggle = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);
    this.keyTransform = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.V);

    this.player.setControls(this.cursors, this.keyShoot, this.keyToggle, this.keyTransform);

    // collisions
    this.physics.add.overlap(this.bullets, this.enemies, this.onBulletHit, null, this);
    this.physics.add.overlap(this.player.sprite, this.enemies, this.onPlayerHit, null, this);

    // spawn enemies periodically
    this.time.addEvent({ delay: 1000, callback: this.spawnEnemy, callbackScope: this, loop: true });

    this.updateStateText();
  }

  update(time, delta) {
    this.player.update(time, delta);

    // cleanup off-screen bullets
    this.bullets.children.iterate(b => {
      if (!b) return;
      if (b.y < -50 || b.y > 650) b.destroy();
    });

    // cleanup off-screen enemies
    this.enemies.children.iterate(e => {
      if (!e) return;
      if (e.y > 700) e.destroy();
    });
  }

  spawnEnemy() {
    const x = Phaser.Math.Between(24, 776);
    const e = this.enemies.create(x, -20, 'alien');
    e.setVelocity(0, Phaser.Math.Between(40, 120));
    if (e.body) e.body.allowGravity = false;
    e.setData('hp', 1);
    e.setCollideWorldBounds(false);
    e.setImmovable(false);
  }

  onBulletHit(bullet, enemy) {
    // Robust collision handler: determine which object is the bullet
    let b = bullet, e = enemy;
    if (bullet && !bullet.getData('isBullet') && enemy && enemy.getData && enemy.getData('isBullet')) {
      // swapped
      b = enemy; e = bullet;
    }
    // debug
    // eslint-disable-next-line no-console
    console.log('onBulletHit', { bKey: b ? b.texture && b.texture.key : null, eKey: e ? e.texture && e.texture.key : null });
    if (e) {
      const hp = e.getData('hp') || 1;
      if (hp > 1) {
        e.setData('hp', hp - 1);
      } else if (e && e.destroy) {
        e.destroy();
      }
    }
    if (b && b.destroy) b.destroy();
  }

  onPlayerHit(playerSprite, enemy) {
    // debug
    // eslint-disable-next-line no-console
    console.log('onPlayerHit', { playerKey: playerSprite.texture && playerSprite.texture.key, enemyKey: enemy && enemy.texture && enemy.texture.key });
    // simple response: destroy enemy and flash player
    if (enemy && enemy.destroy) enemy.destroy();
    if (playerSprite) {
      playerSprite.setTint(0xff0000);
      this.time.addEvent({ delay: 120, callback: () => { if (playerSprite) playerSprite.clearTint(); } });
    }
    // TODO: player damage / lives
  }

  addBullet(x, y, velY) {
    const b = this.physics.add.sprite(x, y, 'bullet');
    // ensure physics body is active and not affected by gravity
    if (b.body) {
      b.body.allowGravity = false;
    }
    // set explicit Y velocity
    // set via both helper and direct body in case one doesn't take effect
    b.setVelocity(0, velY);
    if (b.body) b.body.velocity.y = velY;
    b.setData('velY', velY);
    b.setCollideWorldBounds(false);
    b.setData('isBullet', true);
    this.bullets.add(b);
    // debug
    // eslint-disable-next-line no-console
    console.log('bullet created', { x: b.x, y: b.y, velY: velY, velYActual: b.body ? b.body.velocity.y : null });
    return b;
  }

  updateStateText() {
    this.stateText.setText(`State: ${this.player ? this.player.state : ''}`);
    this.time.addEvent({ delay: 200, callback: () => this.updateStateText(), callbackScope: this });
  }
}
