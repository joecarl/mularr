import { inject, component, signal, refBindInput, computed } from 'chispa';
import { TelegramApiService, type TelegramUser } from '../../services/TelegramApiService';
import { DialogService } from '../../services/DialogService';
import { TelegramChatsTable } from './components/TelegramChatsTable';
import { TelegramJoinQueue } from './components/TelegramJoinQueue';
import tpl from './TelegramView.html';
import './TelegramView.css';

/** The panes of the signed-in view, picked with the topbar tabs. */
type Tab = 'chats' | 'join-queue';

/** Telegram account: sign-in flow, the chats that get indexed, and whether Telegram takes part in searches. */
export const TelegramView = component(() => {
	// Services
	const api = inject(TelegramApiService);
	const dialogs = inject(DialogService);

	// Signals
	const authStatus = signal('disconnected');
	const user = signal<TelegramUser | null>(null);
	const loading = signal(false);
	const errorMessage = signal('');
	const searchEnabled = signal(true);
	const tab = signal<Tab>('chats');

	// Input Signals
	const apiId = signal('');
	const apiHash = signal('');
	const inputPhoneNumber = signal('');
	const authCode = signal('');
	const password = signal('');

	// Helpers
	const refreshStatus = async () => {
		try {
			const res = await api.getStatus();

			// Handle different status responses correctly
			const newStatus = res.status || 'disconnected';
			authStatus.set(newStatus);
			user.set(res.user ?? null);
			searchEnabled.set(res.searchEnabled);
		} catch (e) {
			errorMessage.set('Failed to connect to backend service.');
		}
	};

	// Actions
	const startAuth = async () => {
		if (loading.get()) return;
		loading.set(true);
		errorMessage.set('');
		try {
			const res = await api.startAuth(parseInt(apiId.get()), apiHash.get(), inputPhoneNumber.get());
			if (res.error) throw new Error(res.error);
			refreshStatus();
		} catch (e: any) {
			errorMessage.set(e.message || 'Error starting auth');
		} finally {
			loading.set(false);
		}
	};

	const submitCode = async () => {
		if (loading.get()) return;
		loading.set(true);
		errorMessage.set('');
		try {
			const res = await api.submitCode(authCode.get());
			if (res.error) throw new Error(res.error);
			refreshStatus();
		} catch (e: any) {
			errorMessage.set(e.message || 'Error sending code');
		} finally {
			loading.set(false);
		}
	};

	const submitPassword = async () => {
		if (loading.get()) return;
		loading.set(true);
		errorMessage.set('');
		try {
			const res = await api.submitPassword(password.get());
			if (res.error) throw new Error(res.error);
			refreshStatus();
		} catch (e: any) {
			errorMessage.set(e.message || 'Error sending password');
		} finally {
			loading.set(false);
		}
	};

	const logout = async () => {
		if (!(await dialogs.confirm('Are you sure you want to logout?'))) return;
		await api.logout();
		refreshStatus();
	};

	const toggleSearchEnabled = async () => {
		try {
			await api.setSearchEnabled(!searchEnabled.get());
			await refreshStatus();
		} catch (e: any) {
			errorMessage.set(e.message || 'Error updating the search provider');
		}
	};

	// Computed properties
	const isConnected = computed(() => authStatus.get() === 'connected');
	const isDisconnected = computed(() => authStatus.get() === 'disconnected');
	const isWaitingCode = computed(() => authStatus.get() === 'waiting_code');
	const isWaitingPassword = computed(() => authStatus.get() === 'waiting_password');
	const phoneNumber = computed(() => {
		const u = user.get();
		if (!u || !u.phone) return '';
		return '+' + u.phone;
	});

	// Initial load
	refreshStatus();

	return tpl.fragment({
		// Tabs only make sense while signed in; each pane is created when chosen, so only the visible one polls
		viewTabs: { style: { display: () => (isConnected.get() ? '' : 'none') } },
		tabChats: { onclick: () => tab.set('chats'), classes: { active: () => tab.get() === 'chats' } },
		tabJoinQueue: { onclick: () => tab.set('join-queue'), classes: { active: () => tab.get() === 'join-queue' } },
		btnRefresh: { onclick: refreshStatus },
		btnLogout: {
			onclick: logout,
			style: { display: () => (isConnected.get() ? '' : 'none') },
		},

		searchEnabledState: {
			inner: () => (searchEnabled.get() ? 'Enabled' : 'Disabled'),
			style: { color: () => (searchEnabled.get() ? '#008000' : '#800000') },
		},
		btnToggleSearchEnabled: {
			onclick: toggleSearchEnabled,
			inner: () => (searchEnabled.get() ? 'Disable' : 'Enable'),
		},

		errorBanner: {
			inner: errorMessage,
			style: { display: () => (errorMessage.get() ? '' : 'none') },
		},

		statusBadge: {
			inner: authStatus,
			style: {
				color: () => {
					switch (authStatus.get()) {
						case 'connected':
							return '#008000';
						case 'disconnected':
							return '#800000';
						default:
							return '#000080';
					}
				},
				fontWeight: 'bold',
			},
		},
		phoneDisplay: {
			style: { display: () => (user.get() ? '' : 'none') },
		},
		phoneText: { inner: phoneNumber },

		// Panels visibility
		panelDisconnected: {
			style: { display: () => (isDisconnected.get() ? '' : 'none') },
		},
		panelWaitingCode: {
			style: { display: () => (isWaitingCode.get() ? '' : 'none') },
		},
		panelWaitingPassword: {
			style: { display: () => (isWaitingPassword.get() ? '' : 'none') },
		},
		// The panes only exist while signed in and while their tab is active: they load on creation and their pollers stop on unmount
		panelConnected: {
			style: { display: () => (isConnected.get() ? '' : 'none') },
			inner: () => {
				if (!isConnected.get()) return null;
				const onError = (message: string) => errorMessage.set(message);
				return tab.get() === 'chats' ? TelegramChatsTable({ onError }) : TelegramJoinQueue({ onError });
			},
		},

		// Inputs use _ref for manual binding
		inputApiId: {
			_ref: refBindInput(apiId),
		},
		inputApiHash: {
			_ref: refBindInput(apiHash),
		},
		inputPhone: {
			_ref: refBindInput(inputPhoneNumber),
		},

		btnStartAuth: {
			onclick: startAuth,
			inner: () => (loading.get() ? 'Sending...' : 'Send Code'),
			disabled: loading,
		},

		inputCode: {
			_ref: refBindInput(authCode),
		},

		btnSubmitCode: {
			onclick: submitCode,
			inner: () => (loading.get() ? 'Verifying...' : 'Submit Code'),
			disabled: loading,
		},

		inputPassword: {
			_ref: refBindInput(password),
		},

		btnSubmitPassword: {
			onclick: submitPassword,
			inner: () => (loading.get() ? 'Verifying...' : 'Submit Password'),
			disabled: loading,
		},
	});
});
