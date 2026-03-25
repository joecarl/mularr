import './styles/style.css';
import { appendChild } from 'chispa';
import { services } from './services/container/ServiceContainer';
import { LocalPrefsService } from './services/LocalPrefsService';
import { AuthApiService } from './services/AuthApiService';
import { TransfersContextService } from './services/TransfersContextService';
import { App } from './layout/App';
import { LoginView } from './features/login/LoginView';
import { routes } from './routes';

// TODO: implement chispa service lifecycles so we don't have to worry about this manual pre-initialization hack for services that register disposables in their constructors.

// Pre-initialize singleton services whose constructors register reactive effects.
// If instantiated lazily inside a component setup function, their effects would be
// registered as component disposables and disposed on unmount, breaking reactivity
// for the lifetime of the app session (the constructor never runs again for singletons).
services.get(TransfersContextService);

// Initialize theme
const prefs = services.get(LocalPrefsService);
const savedTheme = prefs.getTheme();
document.documentElement.setAttribute('data-theme', savedTheme);

const mountApp = () => {
	document.body.innerHTML = '';
	appendChild(document.body, App({ routes }));
};

(async () => {
	const authService = services.get(AuthApiService);
	let status = { enabled: false, hasCredentials: false, hasApiKey: false };
	try {
		status = await authService.getStatus();
	} catch {
		// If we can't reach the backend, proceed and let the app handle errors
	}

	if (status.enabled && !authService.isLoggedIn()) {
		appendChild(document.body, LoginView({ onLogin: mountApp }));
	} else {
		mountApp();
	}
})();
