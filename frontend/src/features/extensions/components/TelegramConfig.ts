import { component, signal, bindControlledInput, computed, componentList } from 'chispa';
import { TelegramApiService, type TelegramUser, type TelegramChat } from '../../../services/TelegramApiService';
import { DialogService } from '../../../services/DialogService';
import { services } from '../../../services/container/ServiceContainer';
import tpl from './TelegramConfig.html';
import './TelegramConfig.css';

interface ChatRowProps {
	onToggleChat: (chat: TelegramChat) => void;
}
const ChatsRows = componentList<TelegramChat, ChatRowProps>(
	(c, i, l, props) => {
		return tpl.chatRow({
			nodes: {
				chatName: { inner: () => c.get().title },
				chatType: { inner: () => c.get().type },
				chatStatusBadge: {
					inner: () => (c.get().indexing_enabled ? 'Indexing' : 'Ignored'),
					style: {
						color: () => (c.get().indexing_enabled ? '#008000' : '#808080'),
						fontWeight: 'bold',
					},
				},
				chatActionBtn: {
					inner: () => (c.get().indexing_enabled ? 'Disable' : 'Enable'),
					onclick: () => props!.onToggleChat(c.get()),
				},
			},
		});
	},
	(c) => c.id
);

export const TelegramConfig = component(() => {
	// Services
	const api = services.get(TelegramApiService);
	const dialogs = services.get(DialogService);

	// Signals
	const authStatus = signal('disconnected');
	const user = signal<TelegramUser | null>(null);
	const chats = signal<TelegramChat[]>([]);
	const loading = signal(false);
	const errorMessage = signal('');

	// Input Signals
	const apiId = signal('');
	const apiHash = signal('');
	const inputPhoneNumber = signal('');
	const authCode = signal('');
	const password = signal('');

	// Helpers
	const loadChats = async () => {
		try {
			const list = await api.getChats();
			if (Array.isArray(list)) {
				chats.set(list);
			} else {
				chats.set([]);
			}
		} catch (e) {
			console.error('Failed to load chats', e);
			chats.set([]);
		}
	};

	const refreshStatus = async () => {
		try {
			const res = await api.getStatus();

			// Handle different status responses correctly
			const newStatus = res.status || 'disconnected';
			authStatus.set(newStatus);
			user.set(res.user ?? null);

			if (newStatus === 'connected') {
				loadChats();
			}
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

	const toggleChat = async (chat: TelegramChat) => {
		try {
			await api.updateChatIndexing(chat.id, !chat.indexing_enabled);
			loadChats();
		} catch (e: any) {
			errorMessage.set(e.message || 'Error updating chat');
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

	const noChats = computed(() => {
		const list = chats.get();
		return !list || list.length === 0;
	});

	return tpl.fragment({
		btnRefresh: { onclick: refreshStatus },
		btnLogout: {
			onclick: logout,
			style: { display: () => (isConnected.get() ? '' : 'none') },
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
		panelConnected: {
			style: { display: () => (isConnected.get() ? '' : 'none') },
		},

		// Inputs use _ref for manual binding
		inputApiId: {
			_ref: (el: HTMLInputElement) => {
				bindControlledInput(el, apiId);
			},
		},
		inputApiHash: {
			_ref: (el: HTMLInputElement) => {
				bindControlledInput(el, apiHash);
			},
		},
		inputPhone: {
			_ref: (el: HTMLInputElement) => {
				bindControlledInput(el, inputPhoneNumber);
			},
		},

		btnStartAuth: {
			onclick: startAuth,
			inner: () => (loading.get() ? 'Sending...' : 'Send Code'),
			disabled: loading,
		},

		inputCode: {
			_ref: (el: HTMLInputElement) => {
				bindControlledInput(el, authCode);
			},
		},

		btnSubmitCode: {
			onclick: submitCode,
			inner: () => (loading.get() ? 'Verifying...' : 'Submit Code'),
			disabled: loading,
		},

		inputPassword: {
			_ref: (el: HTMLInputElement) => {
				bindControlledInput(el, password);
			},
		},

		btnSubmitPassword: {
			onclick: submitPassword,
			inner: () => (loading.get() ? 'Verifying...' : 'Submit Password'),
			disabled: loading,
		},

		// Chats List
		btnRefreshChats: { onclick: loadChats },
		chatsList: {
			inner: () => (noChats.get() ? tpl.noChats({}) : ChatsRows(chats, { onToggleChat: toggleChat })),
		},
	});
});
