import './styles/style.css';
import { appendChild } from 'chispa';
import { App } from './App';

// Initialize theme
const savedTheme = localStorage.getItem('mularr.theme') || 'xp';
document.documentElement.setAttribute('data-theme', savedTheme);

appendChild(document.body, App());
