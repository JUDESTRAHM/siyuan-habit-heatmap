/** Pure logic: read habit check-ins out of a SiYuan database (attribute view) and compute streaks + heatmap data. */
export interface HabitTable { title: string; dateCols: { id: string; name: string }[]; habitCols: { id: string; name: string }[]; rows: { date: Record<string, string>; done: Record<string, boolean> }[] }

/** ms timestamp -> YYYY-MM-DD in the local time zone (SiYuan date cells are local-midnight timestamps). */
export function localDay(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse the data object returned by /api/av/renderAttributeView (real SiYuan 3.8 shapes: table = columns/rows, kanban+gallery = fields/cards, possibly nested in groups).
 * `title` should be the document name: the kernel returns data.name "" and view.name is just "Table". */
export function parseHabitAv(data: any, title?: string): HabitTable {
	const view = data?.view;
	if (!view) throw new Error("no view in response");
	const cols: any[] = view.columns ?? view.fields ?? (view.groups ?? []).find((g: any) => g.fields?.length)?.fields ?? [];
	const isDate = (t: string) => t === "date" || t === "created" || t === "updated";
	const dateCols = cols.filter((c) => isDate(c.type)).map((c) => ({ id: c.id, name: c.name || "(untitled)" }));
	const habitCols = cols.filter((c) => c.type === "checkbox").map((c) => ({ id: c.id, name: c.name || "(untitled)" }));
	// table rows, or kanban/gallery cards (top level or inside groups); each item has cells[] or values[] of {value:{keyID,...}}
	const items: any[] = [...(view.rows ?? []), ...(view.cards ?? []), ...(view.groups ?? []).flatMap((g: any) => [...(g.rows ?? []), ...(g.cards ?? [])])];
	const seen = new Set<string>();
	const rows: HabitTable["rows"] = [];
	for (const r of items) {
		if (r.id) { if (seen.has(r.id)) continue; seen.add(r.id); }
		const byId = new Map<string, any>();
		(r.cells ?? r.values ?? []).forEach((cell: any, i: number) => { const v = cell?.value; byId.set(v?.keyID ?? cols[i]?.id ?? "", v); });
		const date: Record<string, string> = {}, done: Record<string, boolean> = {};
		for (const c of dateCols) {
			const v = byId.get(c.id); const x = v?.date ?? v?.created ?? v?.updated;
			if (x && x.isNotEmpty !== false && typeof x.content === "number") date[c.id] = localDay(x.content);
		}
		for (const c of habitCols) done[c.id] = !!byId.get(c.id)?.checkbox?.checked;
		rows.push({ date, done });
	}
	return { title: title || data.name || view.name || "Database", dateCols, habitCols, rows };
}

/** Set of days (YYYY-MM-DD) on which the habit was checked. A day counts if ANY row for that day has it checked. */
export function doneDays(t: HabitTable, dateCol: string, habitIds: string[], mode: "any" | "all" = "any"): Set<string> {
	const perDay = new Map<string, boolean[]>();
	for (const r of t.rows) {
		const d = r.date[dateCol]; if (!d) continue;
		const flags = habitIds.map((h) => !!r.done[h]);
		const cur = perDay.get(d) ?? []; perDay.set(d, cur.concat(mode === "all" ? [flags.every(Boolean)] : [flags.some(Boolean)]));
	}
	const out = new Set<string>();
	for (const [d, v] of perDay) if (v.some(Boolean)) out.add(d);
	return out;
}

const DAY = 86400000;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); }; // noon: safe across DST
export const addDays = (s: string, n: number) => localDay(parse(s).getTime() + n * DAY + (0));
export const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / DAY);

export interface Stats { current: number; longest: number; total: number; rate30: number; since: string | null }

/** Current streak counts back from today; if today is not done yet it counts back from yesterday (a streak is not lost until a day is missed). */
export function streaks(days: Set<string>, today: string): Stats {
	const sorted = [...days].filter((d) => d <= today).sort();
	let longest = 0, run = 0, prev = "";
	for (const d of sorted) { run = prev && diffDays(d, prev) === 1 ? run + 1 : 1; if (run > longest) longest = run; prev = d; }
	let cur = 0, d = days.has(today) ? today : addDays(today, -1);
	while (days.has(d)) { cur++; d = addDays(d, -1); }
	let n30 = 0; for (let i = 0; i < 30; i++) if (days.has(addDays(today, -i))) n30++;
	return { current: cur, longest, total: sorted.length, rate30: Math.round((n30 / 30) * 100), since: sorted[0] ?? null };
}

export interface Cell { day: string; done: boolean; col: number; row: number }
/** Grid for the last `weeks` weeks ending at the week containing `today`; weeks start on Monday (weekStart=1) or Sunday (0). */
export function heatGrid(days: Set<string>, today: string, weeks: number, weekStart = 1): Cell[] {
	const dow = (parse(today).getDay() - weekStart + 7) % 7; // 0 = first day of week
	const first = addDays(today, -dow - (weeks - 1) * 7);
	const out: Cell[] = [];
	for (let c = 0; c < weeks; c++) for (let r = 0; r < 7; r++) { const day = addDays(first, c * 7 + r); if (day <= today) out.push({ day, done: days.has(day), col: c, row: r }); }
	return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export interface HeatRow { name: string; days: Set<string> }
export interface SvgOpts { weeks: number; today: string; weekStart?: number; color?: string; title?: string; labels?: { current: string; longest: string; total: string; rate: string } }

/** One SVG with a GitHub-style heatmap per habit, with streak stats beside each name. */
export function heatmapSvg(rows: HeatRow[], o: SvgOpts): string {
	const cell = 11, gap = 3, step = cell + gap, left = 200, top = 46, rowH = 7 * step + 40, ws = o.weekStart ?? 1, color = o.color ?? "#2da44e";
	const L = o.labels ?? { current: "day streak", longest: "best", total: "days done", rate: "last 30d" };
	const W = left + o.weeks * step + 24, H = top + rows.length * rowH + 10;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>`;
	if (o.title) s += `<text x="16" y="28" font-size="16" font-weight="600" fill="#1f2328">${esc(o.title)}</text>`;
	rows.forEach((row, i) => {
		const y0 = top + i * rowH, st = streaks(row.days, o.today);
		s += `<text x="16" y="${y0 + 14}" font-size="13" font-weight="600" fill="#1f2328">${esc(row.name.slice(0, 22))}</text>`;
		s += `<text x="16" y="${y0 + 34}" font-size="11" fill="#57606a">${st.current} ${esc(L.current)} · ${st.longest} ${esc(L.longest)}</text>`;
		s += `<text x="16" y="${y0 + 50}" font-size="11" fill="#57606a">${st.total} ${esc(L.total)} · ${st.rate30}% ${esc(L.rate)}</text>`;
		let lastMonth = "";
		for (const c of heatGrid(row.days, o.today, o.weeks, ws)) {
			const x = left + c.col * step, y = y0 + 16 + c.row * step;
			s += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${c.done ? color : "#ebedf0"}"><title>${c.day}${c.done ? " ✓" : ""}</title></rect>`;
			if (c.row === 0 && c.day.slice(0, 7) !== lastMonth) { lastMonth = c.day.slice(0, 7); s += `<text x="${x}" y="${y0 + 10}" font-size="10" fill="#57606a">${c.day.slice(5, 7)}</text>`; }
		}
	});
	return s + "</svg>";
}
