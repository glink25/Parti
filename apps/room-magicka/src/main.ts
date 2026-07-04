import { engineInit, setCanvasPixelated, setGLEnable, setShowSplashScreen } from 'littlejsengine';
import { MagickaScene } from './scenes/MagickaScene';
import './styles.css';
const root=document.querySelector<HTMLElement>('#game'); if(!root) throw new Error('Missing #game root');
setCanvasPixelated(false); setGLEnable(false); setShowSplashScreen(false);
const scene=new MagickaScene(); void engineInit(()=>scene.init(),()=>scene.update(),()=>{},()=>scene.render(),()=>{},[],root);
