import { component, signal, refBindInput } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { DialogService } from '../../services/DialogService';
import { MediaApiService, type AddDownloadResponse } from '../../services/MediaApiService';
import { BulkDownloadDialog } from './BulkDownloadDialog';
import tpl from './Ed2kDownloadForm.html';

export interface Ed2kDownloadFormProps {
	onAdded?: () => void;
}

const duplicateStatusLabel = (duplicate: NonNullable<AddDownloadResponse['duplicate']>) =>
	duplicate.isCompleted ? 'already downloaded' : 'already being downloaded';

const truncateName = (name: string, maxLength = 50) => (name.length > maxLength ? name.slice(0, maxLength - 1) + '…' : name);

export const Ed2kDownloadForm = component<Ed2kDownloadFormProps>(({ onAdded }) => {
	const apiService = services.get(MediaApiService);
	const dialogService = services.get(DialogService);
	const downloadLink = signal('');

	const handleDownload = async () => {
		const link = downloadLink.get();
		if (!link) return;
		try {
			const result = await apiService.addDownload(link);
			downloadLink.set('');
			onAdded?.();
			if (result.duplicate) {
				await dialogService.alert(
					`This link matches a file that is ${duplicateStatusLabel(result.duplicate)} as "${result.duplicate.name}".`,
					'Duplicate Download'
				);
			}
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
						const results = await Promise.allSettled(links.map((l) => apiService.addDownload(l)));
						onAdded?.();
						const duplicates = results
							.map((r) => (r.status === 'fulfilled' ? r.value.duplicate : undefined))
							.filter((d): d is NonNullable<AddDownloadResponse['duplicate']> => !!d);
						if (duplicates.length > 0) {
							const lines = duplicates.map((d) => `• ${truncateName(d.name)}`);
							await dialogService.alert(
								`${duplicates.length} of ${links.length} links match files already in transfers:\n${lines.join('\n')}`,
								'Duplicate Downloads'
							);
						}
					},
					onCancel: close,
				}),
		});
	};

	return tpl.fragment({
		downloadInput: {
			_ref: refBindInput(downloadLink),
		},
		downloadBtn: { onclick: handleDownload },
		bulkDownloadBtn: { onclick: handleBulkImport },
	});
});
