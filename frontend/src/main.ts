import './styles/style.css';
import { appendChild } from 'chispa';
import { services } from './services/container/ServiceContainer';
import { LocalPrefsService } from './services/LocalPrefsService';
import { App } from './layout/App';
import { routes } from './routes';

// Initialize theme
const prefs = services.get(LocalPrefsService);
const savedTheme = prefs.getTheme();
document.documentElement.setAttribute('data-theme', savedTheme);

appendChild(document.body, App({ routes }));
