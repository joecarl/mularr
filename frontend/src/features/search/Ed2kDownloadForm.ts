import { component, signal, bindControlledInput } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { DialogService } from '../../services/DialogService';
import { MediaApiService } from '../../services/MediaApiService';
import { BulkDownloadDialog } from './BulkDownloadDialog';
import tpl from './Ed2kDownloadForm.html';

export interface Ed2kDownloadFormProps {
	onAdded?: () => void;
}

export const Ed2kDownloadForm = component<Ed2kDownloadFormProps>(({ onAdded }) => {
	const apiService = services.get(MediaApiService);
	const dialogService = services.get(DialogService);
	const downloadLink = signal('');

	const handleDownload = async () => {
		const link = downloadLink.get();
		if (!link) return;
		try {
			await apiService.addDownload(link);
			downloadLink.set('');
			onAdded?.();
		} catch (e: any) {
			await dialogService.alert('Error adding download: ' + e.message, 'Download Error');
		}
	};

	const handleBulkImport = () => {
		dialogService.open({
			title: 'Bulk Import ED2K Links',
			width: '500px',
			render: (close) =>
				BulkDownloadDialog({
					onConfirm: async (links) => {
						close();
						await Promise.allSettled(links.map((l) => apiService.addDownload(l)));
						onAdded?.();
					},
					onCancel: close,
				}),
		});
	};

	return tpl.fragment({
		downloadInput: {
			_ref: (el): void => {
				bindControlledInput(el, downloadLink);
			},
		},
		downloadBtn: { onclick: handleDownload },
		bulkDownloadBtn: { onclick: handleBulkImport },
	});
});
