import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { native } from './capture.ts';
import './style.css';
import './overlay.css';

if (native) document.documentElement.classList.add('native'); // inside Cue.app: transparent page over Liquid Glass
createRoot(document.getElementById('root')!).render(<App />);
