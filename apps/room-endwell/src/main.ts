import { engineInit, setCanvasPixelated, setGLEnable, setShowSplashScreen } from 'littlejsengine';
import { EndwellScene } from './scenes/EndwellScene';
import './styles.css';
const root = document.querySelector<HTMLElement>('#game'); if (!root) throw new Error('Missing #game root');
setCanvasPixelated(false); setGLEnable(false); setShowSplashScreen(false); const scene = new EndwellScene();
void engineInit(() => scene.init(), () => scene.update(), () => {}, () => scene.render(), () => {}, [], root);
