import './ui/styles.css';
import { SceneManager } from './scene/SceneManager.js';
import { ControlsPanel } from './ui/ControlsPanel.js';

const canvas = document.getElementById('panorama-canvas');
const appEl = document.getElementById('app');

// Ensure canvas fills the window
canvas.style.width = '100vw';
canvas.style.height = '100vh';

SceneManager.init(canvas);
ControlsPanel.init(appEl);
