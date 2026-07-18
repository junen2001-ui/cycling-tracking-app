export default class Player {
  constructor(scene, x, y) {
    this.scene = scene;
    this.sprite = scene.physics.add.sprite(x, y, 'bottle');
    this.sprite.setCollideWorldBounds(true);
    this.state = 'water'; // 'water' or 'air' -- affects bullets & recoil
    this.lastShot = 0;
    this.shootDelay = 300;
    this.transforming = false;
  }

  setControls(cursors, keyShoot, keyToggle, keyTransform) {
    this.cursors = cursors;
    this.keyShoot = keyShoot;
    this.keyToggle = keyToggle;
    this.keyTransform = keyTransform;
  }

  update(time) {
    const speed = 220;
    this.sprite.setVelocity(0);
    if (this.cursors.left.isDown) this.sprite.setVelocityX(-speed);
    else if (this.cursors.right.isDown) this.sprite.setVelocityX(speed);
    if (this.cursors.up.isDown) this.sprite.setVelocityY(-speed);
    else if (this.cursors.down.isDown) this.sprite.setVelocityY(speed);

    if (Phaser.Input.Keyboard.JustDown(this.keyToggle)) {
      this.state = this.state === 'water' ? 'air' : 'water';
      if (this.scene && this.scene.updateStateText) this.scene.updateStateText();
    }

    if (Phaser.Input.Keyboard.JustDown(this.keyTransform) && !this.transforming) {
      this.transforming = true;
      this.sprite.setScale(1.5, 0.7);
      this.scene.time.addEvent({ delay: 400, callback: () => { this.sprite.setScale(1); this.transforming = false; } });
    }

    if (this.keyShoot.isDown && time > this.lastShot + this.shootDelay) {
      this.lastShot = time;
      const speedBullet = this.state === 'water' ? -420 : -650;
      const recoil = this.state === 'water' ? 40 : 12;
      this.sprite.setVelocityY(recoil);
      // debug log
      // eslint-disable-next-line no-console
      console.log('player shoot', { state: this.state, speedBullet, recoil });
      if (this.scene && this.scene.addBullet) this.scene.addBullet(this.sprite.x, this.sprite.y - 26, speedBullet);
    }
  }
}
