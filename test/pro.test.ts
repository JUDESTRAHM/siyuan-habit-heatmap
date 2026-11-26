import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import { parseHabitAv, heatmapSvg } from "../src/habits";
import { monthlyRates, weekdayRates, yearSummary, habitCsv, compareSvg, yearHeatSvg, yearReportHtml, theme } from "../src/pro";
import { verifyLicense } from "../src/license";

const ms = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const col = (id: string, name: string, type: string) => ({ id, name, type });
const dv = (y: number, m: number, d: number) => ({ type: "date", date: { content: ms(y, m, d), isNotEmpty: true } });
const cb = (b: boolean) => ({ type: "checkbox", checkbox: { checked: b } });
const row = (y: number, m: number, d: number, a: boolean, b: boolean) => ({ cells: [{ value: dv(y, m, d) }, { value: cb(a) }, { value: cb(b) }] });
const data = { view: { columns: [col("t", "Day", "date"), col("r", "Run", "checkbox"), col("m", '=Read, "books"', "checkbox")],
	rows: [row(2026, 1, 1, true, false), row(2026, 1, 2, true, true), row(2026, 1, 4, false, true), row(2026, 2, 1, true, false)] } };
const days = (...d: string[]) => new Set(d);

test("monthlyRates counts only days up to today; future months null", () => {
	const r = monthlyRates(days("2026-01-01", "2026-01-02", "2026-02-01"), 2026, "2026-02-10");
	assert.deepEqual(r[0], { month: 1, done: 2, days: 31, rate: 6 });
	assert.deepEqual(r[1], { month: 2, done: 1, days: 10, rate: 10 });
	assert.equal(r[2].rate, null); assert.equal(r.length, 12);
	assert.equal(monthlyRates(days(), 2024, "2024-12-31")[1].days, 29); // leap year
});

test("weekdayRates and yearSummary (streak inside the year only, best month/weekday)", () => {
	// 2026-01-05 is a Monday
	const w = weekdayRates(days("2026-01-05", "2026-01-12"), "2026-01-04", "2026-01-17");
	assert.equal(w[1], 100); assert.equal(w[0], 0); assert.equal(w[3], 0);
	const s = yearSummary({ name: "Run", days: days("2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-03-01") }, 2026, "2026-03-31");
	assert.equal(s.done, 3); assert.equal(s.days, 90); assert.equal(s.longest, 2); assert.equal(s.bestMonth, 1); assert.equal(s.rate, 3);
	const empty = yearSummary({ name: "x", days: days() }, 2026, "2026-03-31");
	assert.equal(empty.bestMonth, null); assert.equal(empty.bestWeekday, null);
});

test("CSV: every day between first and last, 1/0 per habit, BOM, formula-safe quoting", () => {
	const t = parseHabitAv(data, "Habits");
	const csv = habitCsv(t, "t", ["r", "m"]);
	assert.ok(csv.startsWith("﻿"));
	const lines = csv.slice(1).trim().split("\r\n");
	assert.equal(lines[0], `date,Run,"'=Read, ""books"""`);
	assert.equal(lines[1], "2026-01-01,1,0"); assert.equal(lines[3], "2026-01-03,0,0"); assert.equal(lines[4], "2026-01-04,0,1");
	assert.equal(lines.length, 1 + 32); assert.equal(lines.at(-1), "2026-02-01,1,0");
	assert.equal(habitCsv(t, "t", ["r"]).split("\r\n")[0], "﻿date,Run");
});

test("compare chart, year heatmap and report render with the theme and escape names", () => {
	const th = theme("dark", "#ff0000");
	const rows = [{ name: "Run <x>", days: days("2026-01-01", "2026-02-01") }, { name: "Read", days: days("2026-01-02") }];
	const c = compareSvg(rows, 2026, "2026-02-15", th, "T");
	assert.match(c, /^<svg/); assert.ok(c.includes("#0d1117") && c.includes("#ff0000")); assert.ok(c.includes("Run &lt;x&gt;")); assert.ok(!c.includes("<x>"));
	assert.ok(c.includes("Run &lt;x&gt; Jan 2026: 3%"));
	const y = yearHeatSvg(rows[0], 2026, "2026-02-15", th);
	assert.equal((y.match(/<rect x=/g) || []).length, 365); assert.equal((y.match(/fill="#ff0000"/g) || []).length, 2);
	const h = yearReportHtml("My <habits>", rows, 2026, "2026-02-15", th);
	assert.ok(h.startsWith("<!doctype html>")); assert.ok(h.includes("My &lt;habits&gt;")); assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(h));
	assert.equal(theme("nope", "red").color, "#2da44e"); assert.equal(theme("nope", "red").bg, "#ffffff");
	assert.ok(heatmapSvg(rows, { weeks: 4, today: "2026-02-15", theme: th }).includes('fill="#0d1117"'));
});

test("license: key signed for this plugin verifies; other plugin id, tampered and garbage refused", () => {
	const kp = nacl.sign.keyPair();
	const pub = Buffer.from(kp.publicKey).toString("hex");
	const mk = (p: string) => { const payload = Buffer.from(JSON.stringify({ p, e: "abc", s: "cs_test_1", i: "2026-11-26" })).toString("base64url"); return `BR1.${payload}.${Buffer.from(nacl.sign.detached(Buffer.from(`BR1.${payload}`), kp.secretKey)).toString("base64url")}`; };
	assert.equal(verifyLicense(mk("siyuan-habit-heatmap"), "siyuan-habit-heatmap", pub)?.p, "siyuan-habit-heatmap");
	assert.equal(verifyLicense(mk("siyuan-db-reports"), "siyuan-habit-heatmap", pub), null);
	const k = mk("siyuan-habit-heatmap"); assert.equal(verifyLicense(k.slice(0, -2) + (k.endsWith("AA") ? "BB" : "AA"), "siyuan-habit-heatmap", pub), null);
	assert.equal(verifyLicense("hello", "siyuan-habit-heatmap", pub), null);
});

test("license: real production signer (if present on this machine) produces a key the shipped verify accepts", { skip: !fs.existsSync(os.homedir() + "/.config/strahm/ob-license.json") }, () => {
	const key = execFileSync(process.execPath, [fileURLToPath(new URL("../../siyuan-db-reports/tools/sign.mjs", import.meta.url)), "siyuan-habit-heatmap", "test@example.org", "cs_test_selfcheck00"]).toString().trim();
	assert.equal(verifyLicense(key, "siyuan-habit-heatmap")?.p, "siyuan-habit-heatmap");
	assert.equal(verifyLicense(key, "siyuan-db-reports"), null);
});
