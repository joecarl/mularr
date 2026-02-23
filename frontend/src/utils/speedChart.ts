import { formatSpeed } from './formats';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * One data series to render inside a SpeedChart.
 * Multiple series can be passed to the same chart and will share the same Y scale.
 */
export interface ChartSeries {
	/** Y values in chronological order (oldest → newest). */
	values: number[];
	/** CSS colour string used for the line, dot and filled area. */
	color: string;
	/** Human-readable name shown in value-row and future tooltips. */
	label?: string;
	/**
	 * Average time between consecutive samples (ms).
	 * Used for the time-axis span label and the hover crosshair timestamp.
	 */
	intervalMs?: number;
	/** Opacity of the filled area under the line. Defaults to `0.12`. */
	fillOpacity?: number;
	/** Stroke width of the line. Defaults to `1.8`. */
	lineWidth?: number;
}

/** Optional chart-level configuration. All fields are optional. */
export interface SpeedChartOptions {
	/** Canvas / chart background colour. Defaults to `'#0c0c0c'`. */
	background?: string;
	/** Number of horizontal grid lines (excluding the axis itself). Defaults to `4`. */
	gridLines?: number;
	/**
	 * Inner padding (px) around the drawable area.
	 * Defaults: top 8, right 10, bottom 22, left 58.
	 */
	padding?: { top?: number; right?: number; bottom?: number; left?: number };
	/**
	 * Custom formatter for Y-axis labels.
	 * Receives the raw numeric value and must return a display string.
	 * Defaults to the speed formatter (`KB/s`, `MB/s`, …).
	 */
	yFormatter?: (value: number) => string;
	/**
	 * Fixed maximum Y value.
	 * When omitted the maximum is derived from the data (`dataMax × 1.25`) with a
	 * minimum floor of `1024` (1 KB/s) so the chart never collapses to a flat line.
	 */
	maxY?: number;
}

/**
 * Resolved geometry returned by `drawSpeedChart`.
 * Pass it to `drawChartOverlay` to avoid recomputing layout.
 */
export interface ChartLayout {
	pad: { top: number; right: number; bottom: number; left: number };
	chartW: number;
	chartH: number;
	/** Total number of X positions (= length of the longest series). */
	n: number;
	/** The Y scale maximum used for rendering. */
	maxY: number;
	/** The Y-value formatter used. */
	yFmt: (v: number) => string;
	/** Estimated interval between samples in ms (from series metadata). */
	intervalMs: number | undefined;
	/** Convert sample index (0 … n-1) → canvas X pixel. */
	xOf: (idx: number) => number;
	/** Convert numeric value → canvas Y pixel. */
	yOf: (v: number) => number;
	/** Convert canvas pixel X → nearest sample index, clamped to [0, n-1]. */
	idxAt: (canvasX: number) => number;
}

// ── Drawing functions ─────────────────────────────────────────────────────────

/**
 * Renders one or more time-series lines onto a `<canvas>` element.
 *
 * All series share the same X (time) and Y scale.  Series with fewer points
 * than the longest one are right-aligned so the newest sample always sits at x = right.
 *
 * @returns The resolved `ChartLayout` — pass it to `drawChartOverlay` for hover effects.
 *          Returns `null` if the canvas has zero size.
 */
export function drawSpeedChart(canvas: HTMLCanvasElement, series: ChartSeries[], options: SpeedChartOptions = {}): ChartLayout | null {
	// ── Size sync ─────────────────────────────────────────────────────────
	const parent = canvas.parentElement;
	const W = parent ? parent.clientWidth : canvas.clientWidth;
	const H = parent ? parent.clientHeight : canvas.clientHeight;
	if (W <= 0 || H <= 0) return null;

	if (canvas.width !== W || canvas.height !== H) {
		canvas.width = W;
		canvas.height = H;
	}

	const ctx = canvas.getContext('2d');
	if (!ctx) return null;

	// ── Options with defaults ─────────────────────────────────────────────
	const bg = options.background ?? '#0c0c0c';
	const gridCount = options.gridLines ?? 4;
	const pad = {
		top: options.padding?.top ?? 8,
		right: options.padding?.right ?? 10,
		bottom: options.padding?.bottom ?? 22,
		left: options.padding?.left ?? 58,
	};
	const yFmt =
		options.yFormatter ??
		((v: number) => {
			const s = formatSpeed(v);
			return `${s.text} ${s.unit}`;
		});

	// ── Derived geometry ──────────────────────────────────────────────────
	const chartW = W - pad.left - pad.right;
	const chartH = H - pad.top - pad.bottom;
	const n = Math.max(...series.map((s) => s.values.length), 1);
	const allVals = series.flatMap((s) => s.values);
	const dataMax = allVals.length ? Math.max(...allVals) : 0;
	const maxY = options.maxY ?? Math.max(dataMax * 1.25, 1024);
	const timedSeries = series.find((s) => s.values.length && s.intervalMs);
	const intervalMs = timedSeries?.intervalMs;

	const xOf = (idx: number) => pad.left + (idx / (n - 1 || 1)) * chartW;
	const yOf = (v: number) => pad.top + chartH - Math.min(v / maxY, 1) * chartH;
	const idxAt = (canvasX: number) => {
		const raw = ((canvasX - pad.left) / chartW) * (n - 1);
		return Math.max(0, Math.min(n - 1, Math.round(raw)));
	};

	// ── Background ────────────────────────────────────────────────────────
	ctx.clearRect(0, 0, W, H);
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, W, H);

	// ── Grid lines & Y-axis labels ────────────────────────────────────────
	ctx.save();
	ctx.lineWidth = 1;
	ctx.setLineDash([3, 4]);
	ctx.font = '10px monospace';
	ctx.textAlign = 'right';
	ctx.textBaseline = 'middle';
	for (let i = 0; i <= gridCount; i++) {
		const y = pad.top + (i / gridCount) * chartH;
		ctx.strokeStyle = '#2a2a2a';
		ctx.beginPath();
		ctx.moveTo(pad.left, y);
		ctx.lineTo(pad.left + chartW, y);
		ctx.stroke();
		ctx.fillStyle = '#555';
		ctx.fillText(yFmt(maxY * (1 - i / gridCount)), pad.left - 4, y);
	}
	ctx.setLineDash([]);
	ctx.restore();

	// ── Series (filled area + line + endpoint dot) ────────────────────────
	for (const s of series) {
		if (!s.values.length) continue;
		const pts = s.values;
		const offset = n - pts.length;
		const fillOpacity = s.fillOpacity ?? 0.12;
		const lineWidth = s.lineWidth ?? 1.8;

		ctx.save();
		ctx.beginPath();
		for (let i = 0; i < pts.length; i++) {
			const x = xOf(offset + i);
			const y = yOf(pts[i]);
			i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
		}
		ctx.lineTo(xOf(offset + pts.length - 1), pad.top + chartH);
		ctx.lineTo(xOf(offset), pad.top + chartH);
		ctx.closePath();
		ctx.globalAlpha = fillOpacity;
		ctx.fillStyle = s.color;
		ctx.fill();
		ctx.restore();

		ctx.save();
		ctx.beginPath();
		for (let i = 0; i < pts.length; i++) {
			const x = xOf(offset + i);
			const y = yOf(pts[i]);
			i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
		}
		ctx.strokeStyle = s.color;
		ctx.lineWidth = lineWidth;
		ctx.stroke();
		ctx.restore();

		// Endpoint dot (rightmost = latest value)
		ctx.save();
		ctx.beginPath();
		ctx.arc(xOf(n - 1), yOf(pts[pts.length - 1]), 3, 0, Math.PI * 2);
		ctx.fillStyle = s.color;
		ctx.fill();
		ctx.restore();
	}

	// ── X-axis time-span labels ───────────────────────────────────────────
	let spanLabel = '';
	if (intervalMs) {
		const spanMs = intervalMs * n;
		const spanMin = Math.round(spanMs / 60_000);
		const h = Math.floor(spanMin / 60);
		const m = spanMin % 60;
		spanLabel = h > 0 ? `-${h}h ${m}m` : `-${spanMin}m`;
	}
	ctx.save();
	ctx.fillStyle = '#444';
	ctx.font = '9px monospace';
	ctx.textBaseline = 'alphabetic';
	ctx.textAlign = 'left';
	ctx.fillText(spanLabel, pad.left + 1, pad.top + chartH + 14);
	ctx.textAlign = 'right';
	ctx.fillText('now', pad.left + chartW, pad.top + chartH + 14);
	ctx.restore();

	return { pad, chartW, chartH, n, maxY, yFmt, intervalMs, xOf, yOf, idxAt };
}

/**
 * Draws an interactive hover overlay on top of an already-rendered chart.
 *
 * Call this AFTER `drawSpeedChart` (it does not clear the canvas).
 * Draws:
 *   - a vertical dashed crosshair line at `hoverCanvasX`
 *   - a timestamp label at the top of the crosshair (requires `layout.intervalMs`)
 *   - a larger highlighted dot for each series at the hovered sample position
 *
 * @param canvas         The same canvas that was passed to `drawSpeedChart`.
 * @param layout         The `ChartLayout` returned by the last `drawSpeedChart` call.
 * @param series         The same series array passed to `drawSpeedChart`.
 * @param hoverCanvasX   Canvas X pixel coordinate of the cursor.
 */
export function drawChartOverlay(canvas: HTMLCanvasElement, layout: ChartLayout, series: ChartSeries[], hoverCanvasX: number): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	const { pad, chartW, chartH, n, xOf, yOf, idxAt, intervalMs } = layout;

	// Clamp X to chart area
	const x = Math.max(pad.left, Math.min(pad.left + chartW, hoverCanvasX));
	const idx = idxAt(x);

	// ── Vertical crosshair line ───────────────────────────────────────────
	ctx.save();
	ctx.setLineDash([4, 4]);
	ctx.strokeStyle = 'rgba(255,255,255,0.22)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(x, pad.top);
	ctx.lineTo(x, pad.top + chartH);
	ctx.stroke();
	ctx.setLineDash([]);
	ctx.restore();

	// ── Timestamp label at the top of the crosshair ───────────────────────
	if (intervalMs) {
		const samplesToEnd = n - 1 - idx;
		const msAgo = samplesToEnd * intervalMs;
		const sAgo = Math.round(msAgo / 1000);
		const mAgo = Math.floor(sAgo / 60);
		const remS = sAgo % 60;
		const timeLabel = msAgo < 1000 ? 'now' : mAgo > 0 ? `-${mAgo}m ${remS}s` : `-${remS}s`;

		ctx.save();
		ctx.font = '9px monospace';
		ctx.fillStyle = 'rgba(200,200,200,0.7)';
		ctx.textBaseline = 'top';
		// Position label so it doesn't overflow left or right
		const textW = ctx.measureText(timeLabel).width;
		const labelX = Math.min(x + 4, pad.left + chartW - textW - 2);
		ctx.fillText(timeLabel, labelX, pad.top + 2);
		ctx.restore();
	}

	// ── Highlighted dot for each series at the hovered sample ────────────
	for (const s of series) {
		if (!s.values.length) continue;
		const offset = n - s.values.length;
		const seriesIdx = idx - offset;
		if (seriesIdx < 0 || seriesIdx >= s.values.length) continue;

		const cx = xOf(n - 1 - (n - 1 - idx)); // = xOf(idx)
		const cy = yOf(s.values[seriesIdx]);

		// Halo ring
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, 6, 0, Math.PI * 2);
		ctx.strokeStyle = s.color;
		ctx.lineWidth = 1.5;
		ctx.globalAlpha = 0.45;
		ctx.stroke();
		ctx.restore();

		// Filled dot
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
		ctx.fillStyle = s.color;
		ctx.fill();
		ctx.restore();
	}
}
