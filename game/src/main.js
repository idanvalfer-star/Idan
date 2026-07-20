/**
 * main.js — entry point. All wiring lives in GameManager.
 */
import { GameManager } from './core/GameManager.js';

const app = document.getElementById('app');
const ui = document.getElementById('ui');

window.game = new GameManager(app, ui); // exposed for debugging
