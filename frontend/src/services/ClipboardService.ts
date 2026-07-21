import { services } from './container/ServiceContainer';
import { DialogService } from './DialogService';
import { ManualCopyDialog } from '../components/ManualCopyDialog';

export class ClipboardService {
	/**
	 * Copies text to the clipboard. The app is often deployed over plain HTTP
	 * (non-secure context), where the async Clipboard API is unavailable, so it
	 * falls back to the legacy execCommand('copy') and, as a last resort, opens
	 * a dialog so the user can copy the text manually.
	 *
	 * Returns true if the text was copied programmatically, false if the
	 * manual-copy dialog was shown instead.
	 */
	public async copy(text: string): Promise<boolean> {
		// if (await this.tryClipboardApi(text)) return true;
		// if (this.tryExecCommand(text)) return true;
		this.openManualCopyDialog(text);
		return false;
	}

	private async tryClipboardApi(text: string): Promise<boolean> {
		if (!navigator.clipboard?.writeText) return false;
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			return false;
		}
	}

	private tryExecCommand(text: string): boolean {
		const previouslyFocused = document.activeElement;
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', '');
		// Keep it out of sight without display:none, which would prevent selection
		textarea.style.position = 'fixed';
		textarea.style.top = '0';
		textarea.style.left = '-9999px';
		document.body.appendChild(textarea);
		textarea.select();
		textarea.setSelectionRange(0, text.length);
		let copied = false;
		try {
			copied = document.execCommand('copy');
		} catch {
			copied = false;
		}
		textarea.remove();
		if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
		return copied;
	}

	private openManualCopyDialog(text: string) {
		services.get(DialogService).open({
			title: 'Copy to Clipboard',
			width: '420px',
			render: (close) => ManualCopyDialog({ text, onClose: close }),
		});
	}
}
