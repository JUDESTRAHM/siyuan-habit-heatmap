/** Pro features (license key required in the UI): year-in-review report, multi-habit comparison chart, CSV export, custom themes. Pure functions. */
import { addDays, diffDays, localDay, streaks, type HabitTable, type HeatRow } from "./habits";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate(); // m = 1..12

/** Theme for every SVG/HTML output. Free users get the light theme with one of 4 preset colors; Pro unlocks any color + dark/sepia/high-contrast. */
export interface Theme { bg: string; empty: string; fg: string; muted: string; color: string }
export const THEMES: Record<string, Omit<Theme, "color">> = {
	light: { bg: "#ffffff", empty: "#ebedf0", fg: "#1f2328", muted: "#57606a" },
	dark: { bg: "#0d1117", empty: "#21262d", fg: "#e6edf3", muted: "#8b949e" },
	sepia: { bg: "#fbf6ec", empty: "#ece3d0", fg: "#3b2f20", muted: "#7a6a55" },
	contrast: { bg: "#ffffff", empty: "#d0d7de", fg: "#000000", muted: "#24292f" },
};
export const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);
export function theme(name: string, color: string): Theme {
	return { ...(THEMES[name] ?? THEMES.light), color: isHex(color) ? color : "#2da44e" };
}

/** Distinct series colors for the comparison chart (first = the user's color). */
export const SERIES = ["#2da44e", "#0969da", "#8250df", "#fb8500", "#cf222e", "#1b7c83", "#bf3989", "#6e7781"];

export interface MonthRate { month: number; done: number; days: number; rate: number | null }
/** Completion per calendar month of `year`, counting only days up to `today` (future months = null). */
export function monthlyRates(days: Set<string>, year: number, today: string): MonthRate[] {
	const out: MonthRate[] = [];
	for (let m = 1; m <= 12; m++) {
		let done = 0, n = 0;
		for (let d = 1; d <= daysInMonth(year, m); d++) { const k = `${year}-${pad(m)}-${pad(d)}`; if (k > today) break; n++; if (days.has(k)) done++; }
		out.push({ month: m, done, days: n, rate: n ? Math.round((done / n) * 100) : null });
	}
	return out;
}

/** Completion rate per weekday (0 = Sunday .. 6 = Saturday) for days in [from, to]. */
export function weekdayRates(days: Set<string>, from: string, to: string): (number | null)[] {
	const done = Array(7).fill(0), n = Array(7).fill(0);
	for (let d = from, i = 0; d <= to && i < 4000; d = addDays(d, 1), i++) { const w = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12).getDay(); n[w]++; if (days.has(d)) done[w]++; }
	return n.map((x, i) => (x ? Math.round((done[i] / x) * 100) : null));
}

export interface YearSummary { name: string; done: number; days: number; rate: number; longest: number; bestMonth: number | null; bestWeekday: number | null }
/** Year-in-review numbers for one habit. Streaks are measured inside the year only. */
export function yearSummary(row: HeatRow, year: number, today: string): YearSummary {
	const from = `${year}-01-01`, end = `${year}-12-31` < today ? `${year}-12-31` : today;
	const inYear = new Set([...row.days].filter((d) => d >= from && d <= end));
	const n = end >= from ? diffDays(end, from) + 1 : 0;
	const months = monthlyRates(inYear, year, end);
	let bestMonth: number | null = null; for (const m of months) if (m.rate !== null && m.done > 0 && (bestMonth === null || m.rate > months[bestMonth - 1].rate!)) bestMonth = m.month;
	const wd = n ? weekdayRates(inYear, from, end) : Array(7).fill(null);
	let bestWeekday: number | null = null; wd.forEach((r, i) => { if (r !== null && r > 0 && (bestWeekday === null || r > wd[bestWeekday]!)) bestWeekday = i; });
	return { name: row.name, done: inYear.size, days: n, rate: n ? Math.round((inYear.size / n) * 100) : 0, longest: streaks(inYear, end).longest, bestMonth, bestWeekday };
}

/** CSV: one line per calendar day from the first to the last dated row (inclusive), 1/0 per habit. UTF-8 with BOM so Excel opens Chinese names. */
export function habitCsv(t: HabitTable, dateCol: string, habitIds: string[]): string {
	const cols = t.habitCols.filter((h) => habitIds.includes(h.id));
	const per = new Map<string, Set<string>>();
	for (const r of t.rows) { const d = r.date[dateCol]; if (!d) continue; const s = per.get(d) ?? new Set<string>(); for (const h of cols) if (r.done[h.id]) s.add(h.id); per.set(d, s); }
	const q = (v: string) => (/[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? "'" : "") + v.replace(/"/g, '""')}"` : v);
	const lines = [["date", ...cols.map((c) => c.name)].map(q).join(",")];
	const keys = [...per.keys()].sort();
	if (keys.length) for (let d = keys[0], i = 0; d <= keys[keys.length - 1] && i < 40000; d = addDays(d, 1), i++) { const s = per.get(d); lines.push([d, ...cols.map((c) => (s?.has(c.id) ? "1" : "0"))].join(",")); }
	return "﻿" + lines.join("\r\n") + "\r\n";
}

export interface Labels { months: string[]; weekdays: string[] }
export const EN: Labels = { months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };

/** Multi-habit comparison: monthly completion % per habit as grouped bars for the given year. */
export function compareSvg(rows: HeatRow[], year: number, today: string, th: Theme, title = "", L: Labels = EN): string {
	const left = 44, top = title ? 44 : 20, plotH = 200, groupW = 56, W = left + 12 * groupW + 20, legendY = top + plotH + 34, H = legendY + 22 * Math.ceil(rows.length / 4) + 10;
	const colors = [th.color, ...SERIES.filter((c) => c.toLowerCase() !== th.color.toLowerCase())];
	const bw = Math.max(3, Math.min(14, Math.floor((groupW - 10) / Math.max(1, rows.length))));
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><rect width="${W}" height="${H}" fill="${th.bg}"/>`;
	if (title) s += `<text x="16" y="28" font-size="16" font-weight="600" fill="${th.fg}">${esc(title)}</text>`;
	for (const p of [0, 25, 50, 75, 100]) { const y = top + plotH - (p / 100) * plotH; s += `<line x1="${left}" x2="${W - 16}" y1="${y}" y2="${y}" stroke="${th.empty}"/><text x="${left - 6}" y="${y + 4}" font-size="10" text-anchor="end" fill="${th.muted}">${p}%</text>`; }
	const rates = rows.map((r) => monthlyRates(r.days, year, today));
	for (let m = 0; m < 12; m++) {
		const gx = left + m * groupW + 5;
		rows.forEach((r, i) => { const v = rates[i][m].rate; if (v === null) return; const h = (v / 100) * plotH; s += `<rect x="${gx + i * bw}" y="${top + plotH - h}" width="${bw - 1}" height="${h}" fill="${colors[i % colors.length]}"><title>${esc(r.name)} ${L.months[m]} ${year}: ${v}%</title></rect>`; });
		s += `<text x="${gx + (groupW - 10) / 2}" y="${top + plotH + 16}" font-size="10" text-anchor="middle" fill="${th.muted}">${L.months[m]}</text>`;
	}
	rows.forEach((r, i) => { const x = 16 + (i % 4) * 180, y = legendY + Math.floor(i / 4) * 22; s += `<rect x="${x}" y="${y - 9}" width="10" height="10" rx="2" fill="${colors[i % colors.length]}"/><text x="${x + 16}" y="${y}" font-size="12" fill="${th.fg}">${esc(r.name.slice(0, 24))}</text>`; });
	return s + "</svg>";
}

/** Calendar-year heatmap (Jan 1 to Dec 31, weeks as columns) for one habit. */
export function yearHeatSvg(row: HeatRow, year: number, today: string, th: Theme, weekStart = 1, L: Labels = EN): string {
	const cell = 11, gap = 2, step = cell + gap, left = 8, top = 16;
	const first = `${year}-01-01`, wd = (d: string) => (new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12).getDay() - weekStart + 7) % 7;
	const start = addDays(first, -wd(first)), weeks = Math.ceil((diffDays(`${year}-12-31`, start) + 1) / 7);
	const W = left + weeks * step + 8, H = top + 7 * step + 4;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><rect width="${W}" height="${H}" fill="${th.bg}"/>`;
	let lastM = -1;
	for (let c = 0; c < weeks; c++) {
		const end = addDays(start, c * 7 + 6), m = +end.slice(5, 7) - 1; // label a month at the first week that ends inside it
		if (end.slice(0, 4) === String(year) && m !== lastM) { lastM = m; s += `<text x="${left + c * step}" y="${top - 5}" font-size="9" fill="${th.muted}">${L.months[m]}</text>`; }
		for (let r = 0; r < 7; r++) {
			const d = addDays(start, c * 7 + r); if (d.slice(0, 4) !== String(year)) continue;
			const fill = d > today ? "none" : row.days.has(d) ? th.color : th.empty;
			s += `<rect x="${left + c * step}" y="${top + r * step}" width="${cell}" height="${cell}" rx="2" fill="${fill}"${fill === "none" ? ` stroke="${th.empty}"` : ""}><title>${d}${row.days.has(d) ? " ✓" : ""}</title></rect>`;
		}
	}
	return s + "</svg>";
}

export interface ReportText { heading: string; habit: string; done: string; rate: string; longest: string; bestMonth: string; bestDay: string; compare: string; generated: string; print: string }
export const EN_REPORT: ReportText = { heading: "Year in review", habit: "Habit", done: "Days done", rate: "Completion", longest: "Longest streak", bestMonth: "Best month", bestDay: "Best weekday", compare: "Monthly completion by habit", generated: "Generated", print: "Print / Save as PDF" };

/** Self-contained printable HTML (A4/Letter friendly). Opens the print dialog from a button; nothing external is loaded. */
export function yearReportHtml(title: string, rows: HeatRow[], year: number, today: string, th: Theme, weekStart = 1, R: ReportText = EN_REPORT, L: Labels = EN): string {
	const sums = rows.map((r) => yearSummary(r, year, today));
	const tr = sums.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.done} / ${x.days}</td><td>${x.rate}%</td><td>${x.longest}</td><td>${x.bestMonth ? L.months[x.bestMonth - 1] : "-"}</td><td>${x.bestWeekday !== null ? L.weekdays[x.bestWeekday] : "-"}</td></tr>`).join("");
	const maps = rows.map((r, i) => `<section><h3>${esc(r.name)} <small>${sums[i].done} · ${sums[i].rate}% · ${sums[i].longest}</small></h3>${yearHeatSvg(r, year, today, th, weekStart, L)}</section>`).join("");
	return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${year} - ${esc(R.heading)}</title><style>
body{font:14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:${th.bg};color:${th.fg};max-width:980px;margin:24px auto;padding:0 20px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}h3{font-size:14px;margin:18px 0 6px}h3 small{font-weight:400;color:${th.muted}}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid ${th.empty}}th{color:${th.muted};font-weight:600}
.meta{color:${th.muted}}svg{max-width:100%;height:auto}button{font:600 14px system-ui;padding:8px 14px;border-radius:6px;border:1px solid ${th.muted};background:${th.bg};color:${th.fg};cursor:pointer}
section{break-inside:avoid}@media print{button{display:none}body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><button onclick="print()">${esc(R.print)}</button>
<h1>${esc(title)}: ${esc(R.heading)} ${year}</h1><p class="meta">${esc(R.generated)} ${today}</p>
<table><thead><tr><th>${esc(R.habit)}</th><th>${esc(R.done)}</th><th>${esc(R.rate)}</th><th>${esc(R.longest)}</th><th>${esc(R.bestMonth)}</th><th>${esc(R.bestDay)}</th></tr></thead><tbody>${tr}</tbody></table>
${maps}<h2>${esc(R.compare)}</h2>${compareSvg(rows, year, today, th, "", L)}</body></html>`;
}

export { localDay };
