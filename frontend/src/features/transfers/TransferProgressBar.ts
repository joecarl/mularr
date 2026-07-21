import { component, computed, effect, Signal } from 'chispa';
import { Transfer } from '../../services/MediaApiService';
import { CHUNK_STATUS } from '../../services/AmuleApiService';
import tpl from './TransferProgressBar.html';
import './TransferProgressBar.css';

export interface TransferProgressBarProps {
	transfer: Signal<Transfer>;
	/**
	 * When true, detailed chunk visualization is shown whenever chunk data exists.
	 */
	preferChunked: boolean;
}

const CHUNK_COLOR: Record<CHUNK_STATUS, string> = {
	[CHUNK_STATUS.UNAVAILABLE]: '#f90000',
	[CHUNK_STATUS.AVAILABLE]: '#00d2ff',
	[CHUNK_STATUS.COMPLETE]: '#686868',
	[CHUNK_STATUS.DOWNLOADING]: '#dfd405',
};

function getAvailableColor(availability: number): string {
	const g = Math.max(0, 210 - 22 * (availability - 1));
	return `rgb(0, ${g}, 255)`;
}

function drawChunks(canvas: HTMLCanvasElement, states: CHUNK_STATUS[], availability: number[]): void {
	const cssWidth = canvas.clientWidth;
	const cssHeight = canvas.clientHeight;
	if (cssWidth <= 0 || cssHeight <= 0 || states.length === 0) return;

	const dpr = window.devicePixelRatio || 1;
	const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr));
	const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr));

	if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
		canvas.width = pixelWidth;
		canvas.height = pixelHeight;
	}

	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = '#181818';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const n = states.length;
	const chunkColors: string[] = new Array(n);
	for (let i = 0; i < n; i += 1) {
		const state = states[i];
		const sourceCount = availability[i] ?? 0;
		chunkColors[i] = state === CHUNK_STATUS.AVAILABLE ? getAvailableColor(sourceCount) : CHUNK_COLOR[state];
	}

	let start = 0;
	while (start < n) {
		const color = chunkColors[start];
		let end = start + 1;
		while (end < n && chunkColors[end] === color) end += 1;

		const x0 = (start * canvas.width) / n;
		const x1 = (end * canvas.width) / n;
		const w = x1 - x0;
		if (w > 0) {
			ctx.fillStyle = color;
			ctx.fillRect(x0, 0, w, canvas.height);
		}

		start = end;
	}
}

export const TransferProgressBar = component<TransferProgressBarProps>(({ transfer, preferChunked }) => {
	let chunksCanvas: HTMLCanvasElement | null = null;
	let resizeObserver: ResizeObserver | null = null;

	const shouldShowChunked = () => {
		const chunkInfo = transfer.get().chunkInfo;
		if (!chunkInfo) return false;
		return preferChunked;
	};

	const redrawCanvas = () => {
		if (!chunksCanvas) return;
		const chunkInfo = transfer.get().chunkInfo;
		if (!chunkInfo || !shouldShowChunked()) return;
		drawChunks(chunksCanvas, chunkInfo.chunkStates, chunkInfo.chunkAvailability);
	};

	const progressPercentage = computed(() => {
		const rawProgress = Number(transfer.get().progress ?? 0) * 100;
		const progress = Number.isFinite(rawProgress) ? Math.min(100, Math.max(0, rawProgress)) : 0;
		return progress;
	});

	effect(() => {
		void shouldShowChunked();
		requestAnimationFrame(() => redrawCanvas());
	});

	return tpl.fragment({
		classicProgress: {
			style: { display: () => (shouldShowChunked() ? 'none' : '') },
		},
		progressBar: {
			style: { width: () => `${progressPercentage.get()}%` },
			addClass: () => {
				const t = transfer.get();
				if (t.isCompleted) return 'transfer-progress-bar-complete';
				if (t.stopped || t.statusId === 7) return 'transfer-progress-bar-paused';
				return '';
			},
		},
		progressText: {
			inner: () => progressPercentage.get().toFixed(1) + '%',
		},
		detailedProgress: {
			style: { display: () => (shouldShowChunked() ? '' : 'none') },
			addClass: () => {
				const t = transfer.get();
				if (!t.isCompleted && (t.stopped || t.statusId === 7)) return 'detailed-progress-bar-paused';
				return '';
			},
		},
		chunksCanvas: {
			_ref: (el) => {
				chunksCanvas = el;
				resizeObserver?.disconnect();
				resizeObserver = new ResizeObserver(() => redrawCanvas());
				resizeObserver.observe(el);
				requestAnimationFrame(() => redrawCanvas());
			},
		},
		detailedProgressBar: {
			style: { width: () => `${progressPercentage.get()}%` },
		},
		// detailedProgressText: {
		// 	inner: () => getDetailed()?.progressLabel || '0.0%',
		// },
	});
});
