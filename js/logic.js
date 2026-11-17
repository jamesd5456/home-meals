// Pure helpers (no DOM, no network) so they can be unit tested with `node tests/logic.test.js`.
// All dates are ISO strings "YYYY-MM-DD" and use UTC arithmetic, so daylight saving can't shift a day.

// Spending fortnights start on a shop day, the Wednesday before each plan fortnight (Thu to Wed).
export const BUDGET_ANCHOR = "2026-11-18";

const DAY_MS = 86400000;

function toUTC(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDaysISO(iso, n) {
  return fromUTC(toUTC(iso) + n * DAY_MS);
}

export function diffDays(aISO, bISO) {
  return Math.round((toUTC(aISO) - toUTC(bISO)) / DAY_MS);
}

/* ---------- spend ---------- */

// The 14-day spending window containing `iso`. offset moves whole fortnights (-1 = previous).
export function fortnightFor(iso, offset = 0, anchor = BUDGET_ANCHOR) {
  const k = Math.floor(diffDays(iso, anchor) / 14) + offset;
  const start = addDaysISO(anchor, k * 14);
  return { start, end: addDaysISO(start, 13) };
}

export function summariseSpend(entries, fortnight, target, todayISO) {
  const inWindow = entries.filter((e) => e.spent_on >= fortnight.start && e.spent_on <= fortnight.end);
  const cents = inWindow.reduce((sum, e) => sum + Math.round(Number(e.amount) * 100), 0);
  const total = cents / 100;
  const byStore = {};
  for (const e of inWindow) {
    byStore[e.store] = (byStore[e.store] || 0) + Math.round(Number(e.amount) * 100);
  }
  for (const k of Object.keys(byStore)) byStore[k] /= 100;
  const isCurrent = todayISO >= fortnight.start && todayISO <= fortnight.end;
  const dayNumber = isCurrent ? diffDays(todayISO, fortnight.start) + 1 : null;
  const daysLeft = isCurrent ? 14 - dayNumber : null;
  // Straight-line pace: what you'd have spent by now if spending were even across the 14 days.
  const paceTarget = isCurrent ? Math.round(((target * dayNumber) / 14) * 100) / 100 : null;
  return {
    entries: inWindow,
    total,
    remaining: Math.round((target - total) * 100) / 100,
    pct: target > 0 ? Math.min(100, Math.round((total / target) * 100)) : 0,
    over: total > target,
    byStore,
    isCurrent,
    dayNumber,
    daysLeft,
    paceTarget,
  };
}

/* ---------- night runs and the freezer ---------- */

// Runs of consecutive calendar days rostered "N", starting from `fromISO` (a run already
// under way still counts, from today). roster is { "YYYY-MM-DD": "N" | "D" | ... }.
export function nightRuns(roster, fromISO, horizonDays = 90) {
  const runs = [];
  let current = null;
  for (let i = 0; i <= horizonDays; i++) {
    const iso = addDaysISO(fromISO, i);
    if (roster[iso] === "N") {
      if (!current) {
        current = { start: iso, end: iso, nights: 0 };
        runs.push(current);
      }
      current.end = iso;
      current.nights += 1;
    } else {
      current = null;
    }
  }
  return runs;
}

export function freezerSummary(items) {
  return items.reduce((n, it) => n + (Number(it.portions) || 0), 0);
}

export function ageDays(madeOnISO, todayISO) {
  return diffDays(todayISO, madeOnISO);
}

// How the freezer stacks up against the next night run. One packed meal per night shift.
export function nightRunStatus(roster, items, todayISO) {
  const run = nightRuns(roster, todayISO)[0];
  if (!run) return null;
  const portions = freezerSummary(items);
  return {
    run,
    portions,
    short: Math.max(0, run.nights - portions),
    startsInDays: Math.max(0, diffDays(run.start, todayISO)),
    underway: run.start <= todayISO,
  };
}

/* ---------- tonight ---------- */

export function shiftAdvice(code) {
  switch (code) {
    case "D":
    case "D/T":
      return "Day shift: she eats around 5 to 5:30pm with her mum. Leave a plate for you to reheat when you get home.";
    case "E":
    case "E/T":
      return "Evening shift: pack a portion to reheat at work, and heat it until steaming hot.";
    case "N":
      return "Night shift: take a frozen portion out to defrost in the fridge the night before, and pack it to reheat at work.";
    case "OC":
      return "On call: keep dinner quick (about 15 to 20 minutes) in case you get called in.";
    case "ADO":
      return "Day off: a good day to batch cook for the freezer.";
    default:
      return null;
  }
}

const PREP_ORDER = ["morning", "day", "evening", "after-dinner", "night-before"];

export const PREP_LABELS = {
  morning: "This morning",
  day: "During the day",
  evening: "This evening",
  "after-dinner": "After dinner",
  "night-before": "Tonight, for tomorrow",
};

// Group prep items by time of day, in the order you'd do them.
export function groupPrep(prep) {
  const groups = [];
  for (const when of PREP_ORDER) {
    const items = (prep || []).filter((p) => p.when === when);
    if (items.length) groups.push({ when, label: PREP_LABELS[when], items });
  }
  return groups;
}

/* ---------- shopping quantities and extras ---------- */

// Split "Chicken thigh fillets, 800 g" into a name, a number and a unit so the number can be edited.
// Returns null when there's no trailing quantity (spice lists, "Tahini"), and those stay plain text.
export function parseQty(text) {
  const m = /^(.+?),\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|L|bags?|heads?|packs?|punnets?|loaves|loaf|cans?|boxes|box|bunch)?\b\s*(.*)$/i.exec(text);
  if (!m) return null;
  const unit = [m[3], m[4]].filter(Boolean).join(" ");
  return { name: m[1].trim(), qty: Number(m[2]), unit };
}

// The list you're shopping for now: the first one whose shop day hasn't passed, else the last.
export function currentListIndex(lists, todayISO) {
  const i = lists.findIndex((l) => l.buyDate && l.buyDate >= todayISO);
  return i === -1 ? Math.max(0, lists.length - 1) : i;
}

// Rough aisle for a free-text extra. Order matters: household first, then tinned/frozen, then fresh.
const AISLES = [
  ["household", /dishwasher|detergent|soap|toilet|paper towel|bin liner|nappy|nappies|wipes|shampoo|conditioner|toothpaste|cleaner|spray|laundry|sponge|cling wrap|foil|baking paper|zip.?lock|tissue|deodorant|sunscreen|batter(y|ies)|light ?bulb/i],
  ["pantry", /\b(tin|tinned|can|canned|frozen)\b|baked beans|rice|pasta|bread|flour|\boil\b|sugar|oats|cereal|weet.?bix|noodle|sauce|stock|lentil|chickpea|spice|salt|pepper|biscuit|cracker|jam|coffee|tea\b|tortilla|wrap|couscous|peanut butter|tahini/i],
  ["fridge", /milk|yoghurt|yogurt|cheese|\beggs?\b|butter|cream|feta|ricotta|tofu|hummus|margarine|dip/i],
  ["butcher", /chicken|beef|pork|mince|sausage|steak|bacon|\bham\b|turkey|chop|rump|brisket/i],
  ["seafood", /fish|salmon|prawn|tuna|barramundi|squid|calamari/i],
  ["produce", /apple|banana|kiwi|berr(y|ies)|lemon|lime|orange|avocado|spinach|lettuce|tomato|onion|garlic|ginger|capsicum|carrot|broccoli|potato|cucumber|zucchini|mushroom|pumpkin|corn|beans|herb|parsley|basil|mint|fruit|veg|cabbage|celery|pear|mango|grape|cauliflower|sweet potato|peas/i],
];

export function classifyExtra(text) {
  for (const [key, re] of AISLES) if (re.test(text)) return key;
  return "other";
}

// Which group of a list an aisle belongs in, matched against the group's store name.
const STORE_MATCH = {
  butcher: /butcher/i,
  seafood: /seafood/i,
  produce: /fruit|veg|produce/i,
  fridge: /fridge/i,
  pantry: /pantry/i,
  household: /household/i,
};

export function groupForAisle(groups, aisle) {
  const re = STORE_MATCH[aisle];
  return re ? groups.findIndex((g) => re.test(g.store)) : -1;
}

export const OTHER_GROUP = "Household and other";
