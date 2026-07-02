import Phaser from 'phaser';
import { DoudizhuScene } from './scenes/DoudizhuScene';
import './styles.css';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#071b16',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  render: {
    antialias: true,
  },
  scene: [DoudizhuScene],
};

new Phaser.Game(config);
