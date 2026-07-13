import { engineInit, setCanvasPixelated, setGLEnable, setShowSplashScreen } from 'littlejsengine';
import { MidnightWagerScene } from './scenes/MidnightWagerScene';
import './client/parti-api';
import './styles.css';

const root = document.querySelector<HTMLElement>('#game');
if (!root) throw new Error('Missing #game root element');

setCanvasPixelated(false);
setGLEnable(false);
setShowSplashScreen(false);

const scene = new MidnightWagerScene();
void engineInit(
  () => scene.init(),
  () => scene.update(),
  () => {},
  () => scene.render(),
  () => {},
  [],
  root,
);
