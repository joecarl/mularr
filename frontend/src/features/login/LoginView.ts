import { bindControlledInput, component, signal } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { AuthApiService } from '../../services/AuthApiService';
import tpl from './LoginView.html';
import './LoginView.css';

export interface ILoginViewProps {
	onLogin: () => void;
}

export const LoginView = component<ILoginViewProps>(({ onLogin }) => {
	const authService = services.get(AuthApiService);

	const username = signal('');
	const password = signal('');
	const error = signal('');
	const loading = signal(false);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		error.set('');
		loading.set(true);
		try {
			await authService.login(username.get(), password.get());
			onLogin();
		} catch (err: any) {
			error.set(err.message || 'Login failed');
		} finally {
			loading.set(false);
		}
	};

	return tpl.fragment({
		form: {
			onsubmit: handleSubmit,
		},
		username: {
			_ref: (el) => {
				bindControlledInput(el, username);
			},
		},
		password: {
			_ref: (el) => {
				bindControlledInput(el, password);
			},
		},
		errorMsg: {
			inner: () => error.get(),
			//style: { display: () => (error.get() ? '' : 'none') },
		},
		submitBtn: {
			inner: () => (loading.get() ? 'Signing in...' : 'Sign In'),
			disabled: () => loading.get(),
		},
	});
});
