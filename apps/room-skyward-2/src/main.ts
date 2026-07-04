import { engineInit, setCanvasPixelated, setGLEnable, setShowSplashScreen } from 'littlejsengine';
import { SkywardScene } from './scenes/SkywardScene';
import './styles.css';

const root = document.querySelector<HTMLElement>('#game');
if (!root) throw new Error('Missing #game root');
setCanvasPixelated(false); setGLEnable(false); setShowSplashScreen(false);
const scene = new SkywardScene();
void engineInit(() => scene.init(), () => scene.update(), () => {}, () => scene.render(), () => {}, [], root);
