import { Plugin, Dialog, showMessage, getActiveEditor } from "siyuan";
import { parseHabitAv, doneDays, heatmapSvg, localDay, type HabitTable, type HeatRow } from "./habits";
import { verifyLicense } from "./license";
import { theme, isHex, habitCsv, compareSvg, yearReportHtml, THEMES, type Labels, type ReportText } from "./pro";

const MORE = "https://github.com/JUDESTRAHM/siyuan-db-reports";
const PLUGIN_ID = "siyuan-habit-heatmap";
const CHECKOUT = "https://sd-start.judestrahm.workers.dev/gx/sy/checkout?plugin=" + PLUGIN_ID;
const PRESETS = ["#2da44e", "#0969da", "#8250df", "#fb8500"];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function api<T = any>(path: string, body: unknown): Promise<T> {
	const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const j = await r.json();
	if (j.code !== 0) throw new Error(j.msg || "SiYuan API error " + j.code);
	return j.data as T;
}

export default class HabitHeatmap extends Plugin {
	private prefs: { weeks: number; weekStart: number; color: string; theme: string; license: string } = { weeks: 26, weekStart: 1, color: "#2da44e", theme: "light", license: "" };
	private licensed = false;

	async onload() {
		this.prefs = { ...this.prefs, ...((await this.loadData("settings.json")) || {}) };
		this.licensed = !!verifyLicense(this.prefs.license || "", PLUGIN_ID);
		this.addTopBar({ icon: "iconCalendar", title: this.i18n.title, position: "right", callback: () => this.open() });
		this.addCommand({ langKey: "open", hotkey: "", callback: () => this.open() });
		this.eventBus.on("click-blockicon", ({ detail }: any) => {
			const el: HTMLElement | undefined = detail.blockElements?.[0];
			if (el?.getAttribute("data-type") !== "NodeAttributeView") return;
			detail.menu.addItem({ icon: "iconCalendar", label: this.i18n.title, click: () => this.open(el.getAttribute("data-av-id") || "", el.getAttribute("data-node-id") || "") });
		});
	}

	private th() { return this.licensed ? theme(this.prefs.theme, this.prefs.color) : theme("light", PRESETS.includes(this.prefs.color) ? this.prefs.color : PRESETS[0]); }
	private labels(): Labels { return { months: this.i18n.monthNames.split(","), weekdays: this.i18n.weekdayNames.split(",") }; }

	private async listDatabases(): Promise<{ avID: string; blockID: string; label: string }[]> {
		const rows = await api<any[]>("/api/query/sql", { stmt: "SELECT id, root_id, markdown FROM blocks WHERE type='av' LIMIT 500" });
		const docs = await api<any[]>("/api/query/sql", { stmt: "SELECT id, content FROM blocks WHERE type='d' LIMIT 20000" }).catch(() => []);
		const title = new Map(docs.map((x) => [x.id, x.content]));
		const seen = new Set<string>(); const out: { avID: string; blockID: string; label: string }[] = [];
		for (const r of rows) {
			const m = /data-av-id="([^"]+)"/.exec(r.markdown || ""); if (!m || seen.has(m[1])) continue; seen.add(m[1]);
			out.push({ avID: m[1], blockID: r.id, label: String(title.get(r.root_id) || r.root_id) });
		}
		return out;
	}

	private async insertSvg(svg: string, blockID: string, name: string) {
		const fd = new FormData(); fd.append("assetsDirPath", "/assets/"); fd.append("file[]", new File([svg], `${name}.svg`, { type: "image/svg+xml" }));
		const r = await (await fetch("/api/asset/upload", { method: "POST", body: fd })).json();
		if (r.code !== 0) throw new Error(r.msg);
		const md = `![${name}](${Object.values(r.data.succMap)[0]})`;
		if (blockID) { await api("/api/block/insertBlock", { dataType: "markdown", data: md, previousID: blockID }); return; }
		const root = getActiveEditor(false)?.protyle?.block?.rootID;
		if (!root) throw new Error(this.i18n.noDoc);
		await api("/api/block/appendBlock", { dataType: "markdown", data: md, parentID: root });
	}

	async open(avID = "", blockID = "") {
		const t = this.i18n;
		let dbs: Awaited<ReturnType<HabitHeatmap["listDatabases"]>>;
		try { dbs = await this.listDatabases(); } catch (e: any) { showMessage(String(e.message || e), 6000, "error"); return; }
		if (avID && !dbs.some((x) => x.avID === avID)) dbs.unshift({ avID, blockID, label: t.thisDb });
		if (!dbs.length) { showMessage(t.noDb, 6000, "error"); return; }
		const dlg = new Dialog({ title: t.title, width: "min(1000px,96vw)", content: `<div class="b3-dialog__content" style="padding:12px;max-height:80vh;overflow:auto"><div class="syhh"></div></div>` });
		const root = dlg.element.querySelector(".syhh") as HTMLElement;
		const st = { db: avID || dbs[0].avID, dateCol: "", habits: new Set<string>(), perfect: false, picked: false, view: "heat", year: new Date().getFullYear() };
		let table: HabitTable | null = null; let svg = ""; let lastRows: HeatRow[] = [];
		const blockOf = () => dbs.find((x) => x.avID === st.db)?.blockID || blockID;
		const sel = (id: string, opts: [string, string][], cur: string) => `<select id="${id}" class="b3-select">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
		const draw = () => {
			const box = root.querySelector("#chart") as HTMLElement;
			if (!table || !st.dateCol || !st.habits.size) { svg = ""; box.innerHTML = `<p style="padding:12px">${esc(!table?.habitCols.length ? t.noCheckbox : !table?.dateCols.length ? t.noDate : t.pickHabit)}</p>`; return; }
			const ids = table.habitCols.filter((h) => st.habits.has(h.id)).map((h) => h.id);
			const rows: HeatRow[] = table.habitCols.filter((h) => st.habits.has(h.id)).map((h) => ({ name: h.name, days: doneDays(table!, st.dateCol, [h.id]) }));
			if (st.perfect && ids.length > 1) rows.unshift({ name: t.perfect, days: doneDays(table, st.dateCol, ids, "all") });
			const th = this.th();
			svg = st.view === "compare" && this.licensed
				? compareSvg(rows, st.year, localDay(Date.now()), th, `${table.title} ${st.year}`, this.labels())
				: heatmapSvg(rows, { weeks: this.prefs.weeks, today: localDay(Date.now()), weekStart: this.prefs.weekStart, color: th.color, theme: th, title: table.title, labels: { current: t.current, longest: t.longest, total: t.total, rate: t.rate } });
			box.style.background = th.bg; box.innerHTML = svg; lastRows = rows;
		};
		const render = async () => {
			try { table = parseHabitAv(await api("/api/av/renderAttributeView", { id: st.db, blockID: blockOf(), pageSize: 100000, page: 1, createIfNotExist: false }), (() => { const l = dbs.find((x) => x.avID === st.db)?.label; return l === t.thisDb ? undefined : l; })()); } catch (e: any) { root.innerHTML = `<p>${esc(String(e.message || e))}</p>`; return; }
			if (!table.dateCols.some((c) => c.id === st.dateCol)) st.dateCol = table.dateCols[0]?.id || "";
			const pro = this.licensed ? "" : " 🔒";
			const ys = new Set<number>([new Date().getFullYear()]); for (const r of table.rows) for (const d of Object.values(r.date)) ys.add(+d.slice(0, 4));
			const years = [...ys].filter((y) => y > 1970 && y < 3000).sort((a, b) => b - a);
			st.habits = new Set(table.habitCols.map((h) => h.id));
			root.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px">
<label>${t.database}<br>${sel("db", dbs.map((x) => [x.avID, x.label]), st.db)}</label>
<label>${t.dateCol}<br>${sel("datecol", table.dateCols.map((c) => [c.id, c.name]), st.dateCol)}</label>
<label>${t.range}<br>${sel("weeks", [["13", t.m3], ["26", t.m6], ["52", t.y1]], String(this.prefs.weeks))}</label>
<label>${t.weekStart}<br>${sel("ws", [["1", t.mon], ["0", t.sun]], String(this.prefs.weekStart))}</label>
<label>${t.color}<br>${sel("color", [["#2da44e", t.green], ["#0969da", t.blue], ["#8250df", t.purple], ["#fb8500", t.orange], ["custom", t.custom + pro]], PRESETS.includes(this.prefs.color) ? this.prefs.color : "custom")} <input type="color" id="cpick" value="${esc(isHex(this.prefs.color) ? this.prefs.color : "#2da44e")}" style="vertical-align:middle${!this.licensed || PRESETS.includes(this.prefs.color) ? ";display:none" : ""}"></label>
<label>${t.theme}<br>${sel("theme", Object.keys(THEMES).map((k) => [k, (t as any)["th_" + k] + (k === "light" ? "" : pro)]), this.licensed ? this.prefs.theme : "light")}</label>
<label>${t.view}<br>${sel("view", [["heat", t.viewHeat], ["compare", t.viewCompare + pro]], st.view)}</label>
<label>${t.year}<br>${sel("year", years.map((y) => [String(y), String(y)]), String(st.year))}</label></div>
<div style="margin-bottom:8px">${t.habits}: ${table.habitCols.map((h) => `<label style="margin-right:12px"><input type="checkbox" class="b3-switch" data-h="${esc(h.id)}" checked> ${esc(h.name)}</label>`).join("")}
<label style="margin-right:12px"><input type="checkbox" id="perfect"> ${t.perfectDays}</label></div>
<div id="chart" style="overflow:auto;border:1px solid var(--b3-border-color);border-radius:6px;background:#fff"></div>
<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0"><button class="b3-button b3-button--outline" id="ins">${t.insert}</button><button class="b3-button b3-button--outline" id="svgdl">${t.svgFile}</button>
<button class="b3-button b3-button--outline" id="report">${t.report}${pro}</button><button class="b3-button b3-button--outline" id="csv">${t.csv}${pro}</button></div>
<div style="border-top:1px solid var(--b3-border-color);padding:8px 0">${this.licensed ? `<b>${t.proActive}</b>` : `${t.proOff} <a href="${CHECKOUT}" target="_blank">${t.buy}</a>`}
<div style="display:flex;gap:6px;margin-top:6px"><input id="lic" class="b3-text-field fn__flex-1" placeholder="${t.licensePh}" value="${esc(this.prefs.license || "")}"><button class="b3-button b3-button--text" id="act">${t.activate}</button></div></div>
<div style="border-top:1px solid var(--b3-border-color);padding-top:8px;font-size:12px;opacity:.8">${t.how}<br>${t.more} <a href="${MORE}" target="_blank">Database Charts &amp; Reports</a> (${t.moreNote}).</div>`;
			const q = (id: string) => root.querySelector("#" + id) as HTMLElement;
			const keep = () => this.saveData("settings.json", this.prefs);
			q("db").addEventListener("change", (e) => { st.db = (e.target as HTMLSelectElement).value; render(); });
			q("datecol").addEventListener("change", (e) => { st.dateCol = (e.target as HTMLSelectElement).value; draw(); });
			q("weeks").addEventListener("change", (e) => { this.prefs.weeks = Number((e.target as HTMLSelectElement).value); keep(); draw(); });
			q("ws").addEventListener("change", (e) => { this.prefs.weekStart = Number((e.target as HTMLSelectElement).value); keep(); draw(); });
			const needPro = () => { if (this.licensed) return false; showMessage(t.needPro, 6000, "info"); return true; };
			q("color").addEventListener("change", (e) => { const el = e.target as HTMLSelectElement; if (el.value === "custom") { if (needPro()) { el.value = PRESETS.includes(this.prefs.color) ? this.prefs.color : PRESETS[0]; return; } q("cpick").style.display = ""; this.prefs.color = (q("cpick") as HTMLInputElement).value; } else { q("cpick").style.display = "none"; this.prefs.color = el.value; } keep(); draw(); });
			q("cpick").addEventListener("input", (e) => { if (!this.licensed) return; this.prefs.color = (e.target as HTMLInputElement).value; keep(); draw(); });
			q("theme").addEventListener("change", (e) => { const el = e.target as HTMLSelectElement; if (el.value !== "light" && needPro()) { el.value = "light"; return; } this.prefs.theme = el.value; keep(); draw(); });
			q("view").addEventListener("change", (e) => { const el = e.target as HTMLSelectElement; if (el.value === "compare" && needPro()) { el.value = "heat"; return; } st.view = el.value; draw(); });
			q("year").addEventListener("change", (e) => { st.year = Number((e.target as HTMLSelectElement).value); draw(); });
			q("act").onclick = async () => { const k = (q("lic") as HTMLInputElement).value.trim(); if (!verifyLicense(k, PLUGIN_ID)) { showMessage(t.badKey, 6000, "error"); return; } this.prefs.license = k; this.licensed = true; await keep(); showMessage(t.activated); render(); };
			q("perfect").addEventListener("change", (e) => { st.perfect = (e.target as HTMLInputElement).checked; draw(); });
			root.querySelectorAll<HTMLInputElement>("input[data-h]").forEach((i) => i.addEventListener("change", () => { i.checked ? st.habits.add(i.dataset.h!) : st.habits.delete(i.dataset.h!); draw(); }));
			const safe = (f: () => Promise<void> | void) => async () => { try { await f(); } catch (e: any) { showMessage(String(e.message || e), 7000, "error"); } };
			const fname = () => (table!.title || "habits").replace(/[^\w一-龥-]+/g, "_").slice(0, 40);
			q("ins").onclick = safe(async () => { if (!svg) return; await this.insertSvg(svg, blockOf(), `${fname()}-habits`); showMessage(t.inserted); });
			q("svgdl").onclick = safe(() => { if (!svg) return; const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); const a = document.createElement("a"); a.href = url; a.download = `${fname()}-habits.svg`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); });
			const save = (name: string, mime: string, data: string) => { const url = URL.createObjectURL(new Blob([data], { type: mime })); const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); };
			q("report").onclick = safe(() => { if (needPro() || !lastRows.length) return; const R: ReportText = { heading: t.r_heading, habit: t.r_habit, done: t.r_done, rate: t.r_rate, longest: t.r_longest, bestMonth: t.r_bestMonth, bestDay: t.r_bestDay, compare: t.r_compare, generated: t.r_generated, print: t.r_print }; save(`${fname()}-${st.year}-review.html`, "text/html", yearReportHtml(table!.title, lastRows, st.year, localDay(Date.now()), this.th(), this.prefs.weekStart, R, this.labels())); showMessage(t.reportHint, 9000); });
			q("csv").onclick = safe(() => { if (needPro() || !table || !st.dateCol) return; save(`${fname()}-habits.csv`, "text/csv", habitCsv(table, st.dateCol, table.habitCols.filter((h) => st.habits.has(h.id)).map((h) => h.id))); });
			draw();
		};
		render();
	}
}
