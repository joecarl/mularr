import { component, componentList, signal, effect } from 'chispa';
import { services } from '../../services/container/ServiceContainer';
import { DashboardApiService, type SpeedSample } from '../../services/DashboardApiService';
import type { Transfer } from '../../services/MediaApiService';
import { MediaApiService } from '../../services/MediaApiService';
import { formatSpeed, fbytes, formatRemaining } from '../../utils/formats';
import { smartPoll } from '../../utils/scheduling';
import { getProviderIcon } from '../../services/ProvidersApiService';
import { drawSpeedChart, drawChartOverlay, type ChartSeries, type ChartLayout } from '../../utils/speedChart';
import tpl from './DashboardView.html';
import './DashboardView.css';

// ── Constants & series definitions ───────────────────────────────────────────

/** Maximum number of samples displayed in the chart (~10 min at 5 s polling). */
const MAX_CHART_POINTS = 120;

const CHART_COLORS = {
	total: '#8c8c8c',
	amule: '#9b59b6',
	telegram: '#2aabee',
	upload: '#ffa00a',
};

interface SeriesDef {
	key: keyof SpeedSample;
	label: string;
	color: string;
}

const DL_DEFS: SeriesDef[] = [
	{ key: 'dlTotal', label: 'Total', color: CHART_COLORS.total },
	{ key: 'dlAmule', label: 'aMule', color: CHART_COLORS.amule },
	{ key: 'dlTelegram', label: 'Telegram', color: CHART_COLORS.telegram },
];

const UL_DEFS: SeriesDef[] = [{ key: 'ulAmule', label: 'aMule upload', color: CHART_COLORS.upload }];

// ── Chart helpers ─────────────────────────────────────────────────────────────

function buildSeries(pts: SpeedSample[], defs: SeriesDef[], intervalMs: number): ChartSeries[] {
	return defs.map(({ key, color, label }) => ({
		values: pts.map((s) => (s[key] as number) ?? 0),
		color,
		label,
		intervalMs,
	}));
}

/** Build a value-row container with one coloured span per series. */
function makeValueRow(defs: SeriesDef[]): { el: HTMLElement; items: HTMLElement[] } {
	const el = document.createElement('div');
	el.className = 'chart-value-row';
	const items = defs.map(({ color, label }) => {
		const span = document.createElement('span');
		span.className = 'chart-val-item';
		span.style.color = color;
		span.textContent = `${label}: —`;
		el.appendChild(span);
		return span;
	});
	return { el, items };
}

/** Update the text of each value-row span to show the value at sample `idx`. */
function updateValueItems(items: HTMLElement[], defs: SeriesDef[], pts: SpeedSample[], idx: number): void {
	if (!pts.length) return;
	const sample = pts[Math.max(0, Math.min(idx, pts.length - 1))];
	defs.forEach(({ key, label }, i) => {
		const val = (sample[key] as number) ?? 0;
		const s = formatSpeed(val);
		items[i].textContent = `${label}: ${s.text} ${s.unit}`;
	});
}

// ── Active transfer rows ──────────────────────────────────────────────────────

const ActiveRows = componentList<Transfer>(
	(t) => {
		const tf = () => t.get();
		const progressPct = () => {
			const p = tf().progress;
			return p != null ? `${Math.round(p * 100)}%` : '-';
		};
		const progressWidth = () => {
			const p = tf().progress;
			return p != null ? `${Math.min(100, Math.round(p * 100))}%` : '0%';
		};
		const speedText = () => {
			const spd = tf().speed;
			if (!spd) return '-';
			const s = formatSpeed(spd);
			return `${s.text} ${s.unit}`;
		};
		const remainingText = () => formatRemaining(tf().remaining, tf().speed);

		return tpl.activeRow({
			nodes: {
				aProvider: { inner: () => getProviderIcon(tf().provider) },
				aName: { inner: () => tf().name || 'Unknown', title: () => tf().name || '' },
				aSpeed: { inner: speedText },
				aProgressBar: { style: { width: progressWidth } },
				aProgressPct: { inner: progressPct },
				aRemaining: { inner: remainingText },
			},
		});
	},
	(t) => t.hash
);

// ── DashboardView ─────────────────────────────────────────────────────────────

export const DashboardView = component(() => {
	const dashApi = services.get(DashboardApiService);
	const mediaApi = services.get(MediaApiService);

	// ── Data signals ──────────────────────────────────────────────────────
	const samples = signal<SpeedSample[]>([]);
	let lastTs: number | undefined = undefined;
	const activeTransfers = signal<Transfer[]>([]);

	// ── Canvas + value rows (built imperatively, never re-created) ─────────
	const dlCanvas = document.createElement('canvas');
	const ulCanvas = document.createElement('canvas');
	const { el: dlValueRowEl, items: dlValueItems } = makeValueRow(DL_DEFS);
	const { el: ulValueRowEl, items: ulValueItems } = makeValueRow(UL_DEFS);

	// ── Hover state (plain mutable refs – never rendered via signals) ──────
	const dlLayoutRef = { val: null as ChartLayout | null };
	const ulLayoutRef = { val: null as ChartLayout | null };
	const dlHoverRef = { x: null as number | null };
	const ulHoverRef = { x: null as number | null };

	// ── Signal-agnostic helpers ────────────────────────────────────────────
	const latest = (): SpeedSample | null => {
		const s = samples.get();
		return s.length ? s[s.length - 1] : null;
	};

	const chartSamples = (): SpeedSample[] => {
		const s = samples.get();
		return s.length > MAX_CHART_POINTS ? s.slice(s.length - MAX_CHART_POINTS) : s;
	};

	const fmtSpeed = (v: number) => {
		const s = formatSpeed(v);
		return { val: s.text, unit: s.unit };
	};

	const estimateIntervalMs = (): number => {
		const s = samples.get();
		if (s.length < 2) return 5000;
		const recent = s.slice(-10);
		const diffs = recent.slice(1).map((p, i) => p.ts - recent[i].ts);
		return diffs.reduce((a, b) => a + b, 0) / diffs.length;
	};

	/** Redraws the base chart, optionally re-applies the hover overlay, and updates the value row. */
	function redrawAndUpdate(
		canvas: HTMLCanvasElement,
		layoutRef: { val: ChartLayout | null },
		defs: SeriesDef[],
		valueItems: HTMLElement[],
		hoverX: number | null,
		pts: SpeedSample[],
		intervalMs: number
	): void {
		const series = buildSeries(pts, defs, intervalMs);
		const newLayout = drawSpeedChart(canvas, series);
		if (newLayout) layoutRef.val = newLayout;

		if (hoverX !== null && layoutRef.val) {
			drawChartOverlay(canvas, layoutRef.val, series, hoverX);
			updateValueItems(valueItems, defs, pts, layoutRef.val.idxAt(hoverX));
		} else {
			updateValueItems(valueItems, defs, pts, pts.length - 1);
		}
	}

	// ── Mouse interaction ─────────────────────────────────────────────────
	function attachHoverEvents(
		canvas: HTMLCanvasElement,
		layoutRef: { val: ChartLayout | null },
		defs: SeriesDef[],
		valueItems: HTMLElement[],
		hoverRef: { x: number | null }
	): void {
		canvas.addEventListener('mousemove', (e) => {
			const pts = chartSamples();
			const intervalMs = estimateIntervalMs();
			const series = buildSeries(pts, defs, intervalMs);

			// Redraw base chart and get fresh layout
			const newLayout = drawSpeedChart(canvas, series);
			if (newLayout) layoutRef.val = newLayout;
			if (!layoutRef.val) return;

			// Convert client coords → canvas pixels (handles CSS scaling)
			const rect = canvas.getBoundingClientRect();
			const scaleX = canvas.width / rect.width;
			const rawX = (e.clientX - rect.left) * scaleX;
			const clampedX = Math.max(layoutRef.val.pad.left, Math.min(layoutRef.val.pad.left + layoutRef.val.chartW, rawX));
			hoverRef.x = clampedX;

			drawChartOverlay(canvas, layoutRef.val, series, clampedX);
			updateValueItems(valueItems, defs, pts, layoutRef.val.idxAt(clampedX));
		});

		canvas.addEventListener('mouseleave', () => {
			hoverRef.x = null;
			const pts = chartSamples();
			redrawAndUpdate(canvas, layoutRef, defs, valueItems, null, pts, estimateIntervalMs());
		});
	}

	attachHoverEvents(dlCanvas, dlLayoutRef, DL_DEFS, dlValueItems, dlHoverRef);
	attachHoverEvents(ulCanvas, ulLayoutRef, UL_DEFS, ulValueItems, ulHoverRef);

	// ── Polling ───────────────────────────────────────────────────────────
	const loadHistory = async () => {
		try {
			const resp = await dashApi.getSpeedHistory();
			if (resp.samples.length) {
				samples.set(resp.samples);
				lastTs = resp.samples[resp.samples.length - 1].ts;
			}
		} catch (e) {
			console.error('[Dashboard] Failed to load speed history:', e);
		}
	};
	loadHistory();

	smartPoll(async () => {
		try {
			const since = lastTs;
			const [histResp, transfersResp] = await Promise.all([dashApi.getSpeedHistory(since), mediaApi.getTransfers()]);

			if (histResp.samples.length) {
				const current = samples.get();
				const merged = [...current, ...histResp.samples];
				const capped = merged.length > 10_000 ? merged.slice(merged.length - 10_000) : merged;
				samples.set(capped);
				lastTs = histResp.samples[histResp.samples.length - 1].ts;
			}

			const active = (transfersResp.list ?? []).filter((t) => !t.isCompleted && !t.stopped);
			activeTransfers.set(active);
		} catch (e) {
			console.error('[Dashboard] Polling error:', e);
		}
	}, 5000);

	// ── Chart rendering effects ───────────────────────────────────────────
	effect(() => {
		const pts = chartSamples();
		const intervalMs = estimateIntervalMs();
		requestAnimationFrame(() => {
			redrawAndUpdate(dlCanvas, dlLayoutRef, DL_DEFS, dlValueItems, dlHoverRef.x, pts, intervalMs);
		});
	});

	effect(() => {
		const pts = chartSamples();
		const intervalMs = estimateIntervalMs();
		requestAnimationFrame(() => {
			redrawAndUpdate(ulCanvas, ulLayoutRef, UL_DEFS, ulValueItems, ulHoverRef.x, pts, intervalMs);
		});
	});

	// Redraw on window resize (hover positions become invalid, clear them)
	const onResize = () => {
		dlHoverRef.x = null;
		ulHoverRef.x = null;
		const pts = chartSamples();
		const intervalMs = estimateIntervalMs();
		redrawAndUpdate(dlCanvas, dlLayoutRef, DL_DEFS, dlValueItems, null, pts, intervalMs);
		redrawAndUpdate(ulCanvas, ulLayoutRef, UL_DEFS, ulValueItems, null, pts, intervalMs);
	};
	window.addEventListener('resize', onResize);

	// ── Active transfers summary ──────────────────────────────────────────
	const activeSummary = () => {
		const active = activeTransfers.get();
		const totalSize = active.reduce((acc, t) => acc + (t.size ?? 0), 0);
		const totalCompleted = active.reduce((acc, t) => acc + (t.completed ?? 0), 0);
		const pct = totalSize > 0 ? Math.round((totalCompleted / totalSize) * 100) : 0;
		const totalSpeed = active.reduce((acc, t) => acc + (t.speed ?? 0), 0);
		return { count: active.length, pct, totalCompleted, totalSize, totalSpeed };
	};

	// ── Render ────────────────────────────────────────────────────────────
	return tpl.fragment({
		// Stat tiles
		totalDlVal: { inner: () => fmtSpeed(latest()?.dlTotal ?? 0).val },
		totalDlUnit: { inner: () => fmtSpeed(latest()?.dlTotal ?? 0).unit },
		amuleDlVal: { inner: () => fmtSpeed(latest()?.dlAmule ?? 0).val },
		amuleDlUnit: { inner: () => fmtSpeed(latest()?.dlAmule ?? 0).unit },
		tgDlVal: { inner: () => fmtSpeed(latest()?.dlTelegram ?? 0).val },
		tgDlUnit: { inner: () => fmtSpeed(latest()?.dlTelegram ?? 0).unit },
		ulVal: { inner: () => fmtSpeed(latest()?.ulAmule ?? 0).val },
		ulUnit: { inner: () => fmtSpeed(latest()?.ulAmule ?? 0).unit },
		activeDlVal: { inner: () => String(activeSummary().count) },
		activeUlVal: { inner: () => String(latest()?.totalShared ?? 0) },

		// Charts (canvas + value row)
		dlChartWrap: { inner: dlCanvas },
		dlValueRow: { inner: dlValueRowEl },
		chartLegendDl: {
			inner: DL_DEFS.map((d) =>
				tpl.legendItem({
					nodes: {
						legendDot: { style: { background: d.color } },
						legendLabel: { inner: d.label },
					},
				})
			),
		},
		ulChartWrap: { inner: ulCanvas },
		ulValueRow: { inner: ulValueRowEl },
		chartLegendUl: {
			inner: UL_DEFS.map((d) =>
				tpl.legendItem({
					nodes: {
						legendDot: { style: { background: d.color } },
						legendLabel: { inner: d.label },
					},
				})
			),
		},

		// Active transfers table
		activeList: { inner: () => ActiveRows(activeTransfers) },

		// Active transfers summary bar
		summaryCount: { inner: () => String(activeSummary().count) },
		summarySpeed: {
			inner: () => {
				const s = formatSpeed(activeSummary().totalSpeed);
				return `${s.text} ${s.unit}`;
			},
		},
		summaryProgressBar: { style: { width: () => `${activeSummary().pct}%` } },
		summaryProgressPct: { inner: () => `${activeSummary().pct}%` },
		summaryDownloaded: { inner: () => fbytes(activeSummary().totalCompleted) },
		summarySize: { inner: () => fbytes(activeSummary().totalSize) },
	});
});
