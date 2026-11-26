import test from "node:test";
import assert from "node:assert/strict";
import { parseHabitAv, doneDays, streaks, heatGrid, heatmapSvg, addDays, diffDays, localDay } from "../src/habits";

const ms = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const col = (id: string, name: string, type: string) => ({ id, name, type, hidden: false });
const dv = (y: number, m: number, d: number) => ({ type: "date", date: { content: ms(y, m, d), isNotEmpty: true } });
const cb = (b: boolean) => ({ type: "checkbox", checkbox: { checked: b } });
const data = { name: "Habits", view: { columns: [col("t", "Day", "date"), col("r", "Run", "checkbox"), col("m", "Read", "checkbox"), col("x", "Note", "text")],
	rows: [
		{ cells: [{ value: dv(2026, 11, 20) }, { value: cb(true) }, { value: cb(false) }, { value: { type: "text" } }] },
		{ cells: [{ value: dv(2026, 11, 21) }, { value: cb(true) }, { value: cb(true) }, { value: { type: "text" } }] },
		{ cells: [{ value: dv(2026, 11, 22) }, { value: cb(true) }, { value: cb(true) }, { value: { type: "text" } }] },
		{ cells: [{ value: dv(2026, 11, 24) }, { value: cb(true) }, { value: cb(false) }, { value: { type: "text" } }] },
		{ cells: [{ value: { type: "date", date: { isNotEmpty: false } } }, { value: cb(true) }, { value: cb(true) }, null] },
	] } };

test("parse finds date and checkbox columns only", () => {
	const t = parseHabitAv(data);
	assert.deepEqual(t.habitCols.map((c) => c.name), ["Run", "Read"]); assert.deepEqual(t.dateCols.map((c) => c.name), ["Day"]);
	assert.equal(t.rows.length, 5); assert.equal(t.rows[0].date.t, "2026-11-20"); assert.equal(t.rows[4].date.t, undefined);
});
test("doneDays any/all and rows without a date are ignored", () => {
	const t = parseHabitAv(data);
	assert.deepEqual([...doneDays(t, "t", ["r"])].sort(), ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-24"]);
	assert.deepEqual([...doneDays(t, "t", ["m"])].sort(), ["2026-11-21", "2026-11-22"]);
	assert.deepEqual([...doneDays(t, "t", ["r", "m"], "all")].sort(), ["2026-11-21", "2026-11-22"]);
});
test("duplicate rows on one day: any checked counts", () => {
	const row = (b: boolean) => ({ cells: [{ value: dv(2026, 5, 1) }, { value: cb(b) }] });
	const t = parseHabitAv({ view: { columns: [col("t", "D", "date"), col("h", "H", "checkbox")], rows: [row(false), row(true)] } });
	assert.deepEqual([...doneDays(t, "t", ["h"])], ["2026-05-01"]);
});
test("grouped views are read", () => {
	const t = parseHabitAv({ view: { columns: data.view.columns, groups: [{ rows: data.view.rows.slice(0, 2) }, { rows: data.view.rows.slice(2) }] } });
	assert.equal(t.rows.length, 5);
});
test("day math survives month ends and DST", () => {
	assert.equal(addDays("2026-02-28", 1), "2026-03-01"); assert.equal(addDays("2026-03-01", -1), "2026-02-28");
	assert.equal(addDays("2026-03-08", 1), "2026-03-09"); assert.equal(addDays("2026-11-01", 1), "2026-11-02");
	assert.equal(diffDays("2026-12-01", "2026-11-01"), 30); assert.equal(localDay(ms(2026, 1, 1)), "2026-01-01");
});
test("streaks: current, grace for today, longest, rate", () => {
	const days = new Set(["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-24"]);
	let s = streaks(days, "2026-11-24"); assert.equal(s.current, 1); assert.equal(s.longest, 3); assert.equal(s.total, 4); assert.equal(s.since, "2026-11-20");
	s = streaks(days, "2026-11-25"); assert.equal(s.current, 1, "today not done yet: counts back from yesterday");
	s = streaks(days, "2026-11-26"); assert.equal(s.current, 0, "a missed day breaks the streak");
	s = streaks(new Set(["2026-11-24", "2026-11-25", "2026-11-26"]), "2026-11-26"); assert.equal(s.current, 3); assert.equal(s.rate30, 10);
	assert.deepEqual(streaks(new Set(), "2026-11-26"), { current: 0, longest: 0, total: 0, rate30: 0, since: null });
});
test("future days are not counted", () => {
	assert.equal(streaks(new Set(["2026-12-30"]), "2026-11-26").total, 0);
});
test("heatGrid: columns, Monday start, no future cells", () => {
	const g = heatGrid(new Set(["2026-11-26"]), "2026-11-26", 4, 1); // Thursday
	assert.equal(g[g.length - 1].day, "2026-11-26"); assert.equal(g[g.length - 1].row, 3); assert.equal(g[g.length - 1].col, 3);
	assert.equal(g.length, 3 * 7 + 4); assert.equal(g[0].day, "2026-11-02"); assert.equal(g.filter((c) => c.done).length, 1);
	assert.equal(heatGrid(new Set(), "2026-11-26", 4, 0)[0].day, "2026-11-01");
});
test("svg contains rows, escapes names, is well formed", () => {
	const svg = heatmapSvg([{ name: "Run <5k> & jog", days: new Set(["2026-11-25", "2026-11-26"]) }], { weeks: 10, today: "2026-11-26", title: "T" });
	assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>")); assert.ok(svg.includes("Run &lt;5k&gt; &amp; jog")); assert.equal((svg.match(/#2da44e/g) || []).length, 2);
});
