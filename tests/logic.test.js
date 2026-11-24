import assert from "node:assert/strict";
import {
  addDaysISO, diffDays, fortnightFor, summariseSpend, nightRuns, nightRunStatus,
  freezerSummary, ageDays, shiftAdvice, groupPrep,
  classifyNight, parseForecast, suggestSwap,
  parseQty, currentListIndex, classifyExtra, sectionForAisle, buildGroups, isDoubleTap, compareTicked,
} from "../js/logic.js";

// dates
assert.equal(addDaysISO("2026-11-30", 3), "2026-12-03");
assert.equal(addDaysISO("2026-10-03", 1), "2026-10-04"); // across the Sydney DST change
assert.equal(diffDays("2026-12-07", "2026-11-18"), 19);

// fortnights start Wed 18 Nov, then every 14 days
assert.deepEqual(fortnightFor("2026-11-18"), { start: "2026-11-18", end: "2026-12-01" });
assert.deepEqual(fortnightFor("2026-12-01"), { start: "2026-11-18", end: "2026-12-01" });
assert.deepEqual(fortnightFor("2026-12-02"), { start: "2026-12-02", end: "2026-12-15" });
assert.deepEqual(fortnightFor("2026-11-17"), { start: "2026-11-04", end: "2026-11-17" });
assert.deepEqual(fortnightFor("2026-12-02", -1), { start: "2026-11-18", end: "2026-12-01" });
assert.deepEqual(fortnightFor("2026-11-20", 1), { start: "2026-12-02", end: "2026-12-15" });

// spend: cents-safe totals, window filtering, pace
const entries = [
  { spent_on: "2026-11-18", store: "Woolworths", amount: "180.10" },
  { spent_on: "2026-11-18", store: "Butcher", amount: "40.20" },
  { spent_on: "2026-11-24", store: "Woolworths", amount: 120.7 },
  { spent_on: "2026-12-02", store: "Woolworths", amount: 99 }, // next fortnight
  { spent_on: "2026-11-17", store: "Woolworths", amount: 55 }, // previous fortnight
];
const f = fortnightFor("2026-11-25");
const s = summariseSpend(entries, f, 400, "2026-11-25");
assert.equal(s.total, 341);
assert.equal(s.remaining, 59);
assert.equal(s.pct, 85);
assert.equal(s.over, false);
assert.equal(s.byStore.Woolworths, 300.8);
assert.equal(s.byStore.Butcher, 40.2);
assert.equal(s.isCurrent, true);
assert.equal(s.dayNumber, 8);
assert.equal(s.daysLeft, 6);
assert.equal(s.paceTarget, 228.57);
const over = summariseSpend([{ spent_on: "2026-11-18", store: "Woolworths", amount: 450 }], f, 400, "2026-11-25");
assert.equal(over.over, true);
assert.equal(over.pct, 100);
assert.equal(over.remaining, -50);
const past = summariseSpend(entries, fortnightFor("2026-11-17"), 400, "2026-11-25");
assert.equal(past.isCurrent, false);
assert.equal(past.dayNumber, null);
assert.equal(past.total, 55);

// night runs
const roster = {
  "2026-12-07": "N", "2026-12-08": "N", "2026-12-09": "N", "2026-12-10": "N",
  "2026-12-11": "-", "2027-01-09": "N", "2027-01-10": "N", "2026-12-12": "D",
};
const runs = nightRuns(roster, "2026-11-25");
assert.equal(runs.length, 2);
assert.deepEqual(runs[0], { start: "2026-12-07", end: "2026-12-10", nights: 4 });
assert.deepEqual(runs[1], { start: "2027-01-09", end: "2027-01-10", nights: 2 });
// a run already under way counts from today
const mid = nightRuns(roster, "2026-12-09");
assert.deepEqual(mid[0], { start: "2026-12-09", end: "2026-12-10", nights: 2 });
assert.equal(nightRuns({}, "2026-11-25").length, 0);

// freezer vs night run
const items = [{ portions: 2 }, { portions: "1" }, { portions: 0 }];
assert.equal(freezerSummary(items), 3);
const st = nightRunStatus(roster, items, "2026-11-25");
assert.equal(st.short, 1);
assert.equal(st.startsInDays, 12);
assert.equal(st.underway, false);
assert.equal(nightRunStatus(roster, [{ portions: 5 }], "2026-11-25").short, 0);
assert.equal(nightRunStatus({}, items, "2026-11-25"), null);
assert.equal(nightRunStatus(roster, items, "2026-12-08").underway, true);
assert.equal(ageDays("2026-11-25", "2026-12-09"), 14);

// shift advice and prep grouping
assert.match(shiftAdvice("E"), /pack a portion/);
assert.match(shiftAdvice("N"), /defrost/);
assert.equal(shiftAdvice(undefined), null);
const g = groupPrep([
  { when: "after-dinner", text: "b" }, { when: "morning", text: "a" }, { when: "night-before", text: "c" },
]);
assert.deepEqual(g.map((x) => x.when), ["morning", "after-dinner", "night-before"]);
assert.deepEqual(groupPrep(null), []);

// shopping quantities
assert.deepEqual(parseQty("Chicken thigh fillets, 800 g"), { name: "Chicken thigh fillets", qty: 800, unit: "g", note: "" });
assert.deepEqual(parseQty("Eggs, 18"), { name: "Eggs", qty: 18, unit: "", note: "" });
assert.deepEqual(parseQty("Raw peeled prawns, frozen, 300 g"), { name: "Raw peeled prawns, frozen", qty: 300, unit: "g", note: "" });
assert.deepEqual(parseQty("Milk, 1 L (for pancakes)"), { name: "Milk", qty: 1, unit: "L", note: "(for pancakes)" });
assert.deepEqual(parseQty("Chicken thigh fillets, 800 g (korma)"), { name: "Chicken thigh fillets", qty: 800, unit: "g", note: "(korma)" });
assert.deepEqual(parseQty("Canned pink salmon, 1 x 210 g (catch-up plate uses half)"), { name: "Canned pink salmon", qty: 1, unit: "x 210 g", note: "(catch-up plate uses half)" });
assert.equal(parseQty("Spices: ground cumin, ground coriander, turmeric"), null);
assert.equal(parseQty("Tahini"), null);

// current list and extras sorting
const lists = [{ buyDate: "2026-11-18" }, { buyDate: "2026-11-24" }];
assert.equal(currentListIndex(lists, "2026-11-18"), 0);
assert.equal(currentListIndex(lists, "2026-11-19"), 1);
assert.equal(currentListIndex(lists, "2026-12-01"), 1);
// lists with coversFrom: the latest list that has started covering days stays current, even after its shop day
const lists2 = [
  { buyDate: "2026-11-18", coversFrom: "2026-11-19" },
  { buyDate: "2026-11-24", coversFrom: "2026-11-23" },
  { buyDate: "2026-12-01", coversFrom: "2026-11-30" },
];
assert.equal(currentListIndex(lists2, "2026-11-18"), 0);
assert.equal(currentListIndex(lists2, "2026-11-22"), 0);
assert.equal(currentListIndex(lists2, "2026-11-23"), 1);
assert.equal(currentListIndex(lists2, "2026-11-25"), 1);
assert.equal(currentListIndex(lists2, "2026-11-29"), 1);
assert.equal(currentListIndex(lists2, "2026-11-30"), 2);
assert.equal(classifyExtra("dishwasher tablets"), "household");
assert.equal(classifyExtra("chicken breast"), "butcher");
assert.equal(classifyExtra("canned tomatoes"), "pantry");
assert.equal(classifyExtra("blueberries"), "produce");
assert.equal(classifyExtra("full cream milk"), "fridge");
assert.equal(classifyExtra("frozen peas"), "pantry");
assert.equal(classifyExtra("zzz"), "other");
assert.equal(sectionForAisle("produce"), "fruit-grocer");
assert.equal(sectionForAisle("pantry"), "pantry-other");
assert.equal(sectionForAisle("household"), "household");
assert.equal(sectionForAisle("nonsense"), "other");

// store layout: items come out in layout order, empty sections vanish, unknown sections go to "other"
const layout = { sections: [
  { key: "butcher", label: "Butcher" },
  { key: "canned", label: "Woolworths: canned", aisle: 7 },
  { key: "frozen", label: "Woolworths: frozen" },
  { key: "other", label: "Other" },
] };
const grp = buildGroups([
  { id: "a", section: "frozen" }, { id: "b", section: "butcher" }, { id: "c", section: "canned" },
  { id: "d", section: "nope" }, { id: "e", section: "canned" },
], layout);
assert.deepEqual(grp.map((x) => x.store), ["Butcher", "Woolworths: canned (aisle 7)", "Woolworths: frozen", "Other"]);
assert.deepEqual(grp[1].items.map((x) => x.id), ["c", "e"]);
assert.deepEqual(grp[3].items.map((x) => x.id), ["d"]);
// no "other" section in the layout: stragglers still show, at the end
const g2 = buildGroups([{ id: "a", section: "butcher" }, { id: "z", section: "nope" }], { sections: [{ key: "butcher", label: "Butcher" }] });
assert.deepEqual(g2.map((x) => x.store), ["Butcher", "Other"]);

// double-tap: two taps close together on (about) the same spot
assert.equal(isDoubleTap(null, { t: 100, x: 0, y: 0 }), false);
assert.equal(isDoubleTap({ t: 100, x: 10, y: 10 }, { t: 300, x: 12, y: 11 }), true);
assert.equal(isDoubleTap({ t: 100, x: 10, y: 10 }, { t: 700, x: 10, y: 10 }), false); // too slow
assert.equal(isDoubleTap({ t: 100, x: 10, y: 10 }, { t: 250, x: 200, y: 10 }), false); // moved away
assert.equal(isDoubleTap({ t: 100, x: 10, y: 10 }, { t: 100, x: 10, y: 10 }), false);

// ticked-off order: newest first; untimed ones last in original order
const ticked = [
  { id: "old", t: 0, o: 4 }, { id: "first", t: 1000, o: 0 }, { id: "last", t: 3000, o: 2 },
  { id: "mid", t: 2000, o: 1 }, { id: "old2", t: 0, o: 3 },
];
assert.deepEqual(ticked.sort(compareTicked).map((x) => x.id), ["last", "mid", "first", "old2", "old"]);

console.log("logic tests passed");

// weather: hot above 27 (daily max), cold below 15 (6pm)
assert.equal(classifyNight({ max: 27, evening: 20 }), null);
assert.equal(classifyNight({ max: 27.1, evening: 20 }), "hot");
assert.equal(classifyNight({ max: 20, evening: 15 }), null);
assert.equal(classifyNight({ max: 20, evening: 14.9 }), "cold");
assert.equal(classifyNight(undefined), null);
const fc = parseForecast({
  daily: { time: ["2026-11-22", "2026-11-23"], temperature_2m_max: [31.2, 22] },
  hourly: { time: ["2026-11-22T17:00", "2026-11-22T18:00", "2026-11-23T18:00"], temperature_2m: [29, 28.5, 13] },
});
assert.deepEqual(fc, { "2026-11-22": { max: 31.2, evening: 28.5 }, "2026-11-23": { max: 22, evening: 13 } });
assert.deepEqual(parseForecast(null), {});
const wr = { a: { temp: "hot" }, b: { temp: "cool" }, c: { temp: "either" }, d: { temp: "cool" } };
const wp = [
  { date: "2026-11-21", dinner: "b" }, { date: "2026-11-22", dinner: "a" }, { date: "2026-11-23", dinner: "c" },
  { date: "2026-11-24", dinner: "d" }, { date: "2026-11-25", dinner: "b" }, { date: "2026-12-10", dinner: "b" },
];
assert.equal(suggestSwap(wp, wr, "2026-11-22", "hot").date, "2026-11-24"); // skips the past day and the "either" dish
assert.equal(suggestSwap(wp, wr, "2026-11-23", "hot"), null); // an either dish needs no swap
assert.equal(suggestSwap(wp, wr, "2026-11-24", "cold"), null); // no hot dish ahead
assert.equal(suggestSwap(wp, wr, "2026-11-21", "cold").date, "2026-11-22"); // cool dish on a cold night
console.log("weather tests passed");
