import { engineInit, setCanvasPixelated, setGLEnable, setShowSplashScreen } from 'littlejsengine';
import { DoudizhuScene } from './scenes/DoudizhuScene';
import './styles.css';

const root = document.querySelector<HTMLElement>('#game');
if (!root) throw new Error('Missing #game root element');

setCanvasPixelated(false);
// This room renders all UI on LittleJS's Canvas2D surface. Keeping the default
// WebGL surface would add a second full-screen canvas whose clear pass can
// cover the colored UI primitives in embedded/sandboxed browsers.
setGLEnable(false);
setShowSplashScreen(false);

const scene = new DoudizhuScene();
void engineInit(
  () => scene.init(),
  () => scene.update(),
  () => {},
  () => scene.render(),
  () => {},
  [],
  root,
);
