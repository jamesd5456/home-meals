import { SUPABASE_URL, SUPABASE_ANON_KEY, FORTNIGHT_BUDGET } from "./config.js";
import {
  addDaysISO,
  ageDays,
  buildGroups,
  classifyNight,
  parseForecast,
  suggestSwap,
  classifyExtra,
  compareTicked,
  currentListIndex,
  diffDays,
  fortnightFor,
  freezerSummary,
  groupPrep,
  isDoubleTap,
  nightRunStatus,
  parseQty,
  sectionForAisle,
  shiftAdvice,
  summariseSpend,
} from "./logic.js";

const app = document.getElementById("app");
const statusEl = document.getElementById("status");
const navAccount = document.getElementById("nav-account");

const state = {
  recipes: [],
  byId: {},
  plan: [],
  shopping: [],
  layout: { sections: [] },
  supabase: null,
  user: null,
  checks: {},
  checkedAt: {},
  buyQty: {},
  buyQtyError: "",
  extras: [],
  extrasReady: false,
  extrasError: "",
  roster: {},
  rosterError: "",
  freezer: [],
  freezerReady: false,
  freezerError: "",
  spend: [],
  spendReady: false,
  spendError: "",
  spendOffset: 0,
  recipeFilter: { type: "all", q: "" },
  weather: {},
};

const ALLERGENS = {
  egg: "Egg",
  peanut: "Peanut",
  "tree-nut": "Tree nut",
  dairy: "Dairy",
  wheat: "Wheat",
  soy: "Soy",
  sesame: "Sesame",
  fish: "Fish",
  shellfish: "Shellfish",
};

const SHIFTS = {
  D: { label: "Day", cls: "d" },
  "D/T": { label: "Day+T", cls: "d" },
  E: { label: "Eve", cls: "e" },
  "E/T": { label: "Eve+T", cls: "e" },
  N: { label: "Night", cls: "n" },
  OC: { label: "On call", cls: "oc" },
  ADO: { label: "ADO", cls: "ado" },
};

const LS_PREFIX = "hm:ticks:";
const LS_AT_PREFIX = "hm:tickat:";

/* ---------- helpers ---------- */

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "value" || k === "disabled") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error("Failed to load " + path);
  return r.json();
}

function localISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(iso) {
  return parseISO(iso).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function mondayOf(iso) {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return dt;
}

function addDays(dt, n) {
  const c = new Date(dt);
  c.setDate(c.getDate() + n);
  return c;
}

let statusTimer = null;
function setStatus(msg) {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.hidden = !msg;
  clearTimeout(statusTimer);
  if (msg) statusTimer = setTimeout(() => setStatus(""), 6000);
}

/* ---------- ticks (local + shared) ---------- */

function tickKey(list, item) {
  return `${list}::${item}`;
}

function isChecked(list, item) {
  return !!state.checks[tickKey(list, item)];
}

function loadLocalChecks() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) {
        state.checks[k.slice(LS_PREFIX.length)] = localStorage.getItem(k) === "1";
      } else if (k && k.startsWith(LS_AT_PREFIX)) {
        const t = Number(localStorage.getItem(k));
        if (t) state.checkedAt[k.slice(LS_AT_PREFIX.length)] = t;
      }
    }
  } catch (e) {
    /* storage unavailable: ticks just won't persist locally */
  }
}

async function loadRemoteChecks() {
  if (!state.supabase || !state.user) return;
  const { data, error } = await state.supabase
    .from("meal_checks")
    .select("list_key,item_key,checked,updated_at");
  if (error) {
    setStatus("Couldn't load shared ticks: " + error.message);
    return;
  }
  for (const r of data) applyRemoteTick(r);
}

// A tick row from Supabase (initial load or live): its updated_at is when it was last ticked.
function applyRemoteTick(row) {
  const key = tickKey(row.list_key, row.item_key);
  state.checks[key] = !!row.checked;
  const t = row.updated_at ? Date.parse(row.updated_at) : 0;
  if (row.checked && t) state.checkedAt[key] = t;
  else delete state.checkedAt[key];
}

async function setChecked(list, item, val) {
  const key = tickKey(list, item);
  const now = Date.now();
  state.checks[key] = val;
  if (val) state.checkedAt[key] = now;
  else delete state.checkedAt[key];
  try {
    localStorage.setItem(LS_PREFIX + key, val ? "1" : "0");
    if (val) localStorage.setItem(LS_AT_PREFIX + key, String(now));
    else localStorage.removeItem(LS_AT_PREFIX + key);
  } catch (e) {
    /* ignore */
  }
  if (state.supabase && state.user) {
    const { error } = await state.supabase.from("meal_checks").upsert(
      { list_key: list, item_key: item, checked: val, updated_at: new Date(now).toISOString() },
      { onConflict: "list_key,item_key" }
    );
    if (error) setStatus("Couldn't sync that tick: " + error.message);
  }
}

function refreshTicks(sort = true) {
  document.querySelectorAll("input[data-list]").forEach((cb) => {
    cb.checked = isChecked(cb.dataset.list, cb.dataset.item);
    const row = cb.closest("li");
    if (row) row.setAttribute("aria-checked", String(cb.checked));
  });
  updateProgress(sort);
}

function toggleTick(list, item) {
  setChecked(list, item, !isChecked(list, item));
  refreshTicks(false); // show the new state now; the row moves a moment later
  sortSoon();
}

function updateProgress(sort = true) {
  document.querySelectorAll("details[data-list]").forEach((d) => {
    const boxes = [...d.querySelectorAll("input[data-list]")];
    const done = boxes.filter((b) => b.checked).length;
    const out = d.querySelector(".progress");
    if (!out) return;
    out.textContent = boxes.length ? ` (${done}/${boxes.length})` : "";
  });
  if (sort) sortDone();
}

// Ticked items drop into a "Ticked off" section at the bottom of their list, newest tick first, and
// go back to their aisle (in their original order) if you untick them.
function insertOrdered(ul, li) {
  const o = Number(li.dataset.o);
  const next = [...ul.children].find((c) => Number(c.dataset.o) > o);
  ul.insertBefore(li, next || null);
}

function sortDone() {
  document.querySelectorAll("details.list[data-list]").forEach((d) => {
    const lis = [...d.querySelectorAll("div.group li, .done-section li")];
    if (!lis.length) return;
    // Remember each item's home aisle and position the first time we see it.
    lis.forEach((li, i) => {
      if (!li._home) {
        li._home = li.parentElement;
        li.dataset.o = String(i);
      }
    });
    let sec = d.querySelector(".done-section");
    if (!sec) {
      sec = h("div", { class: "done-section" }, h("div", { class: "store" }), h("ul", { class: "ticks done" }));
      const anchor = d.querySelector("button.clear-ticks");
      if (anchor) d.insertBefore(sec, anchor);
      else d.appendChild(sec);
    }
    const doneUl = sec.querySelector("ul");
    lis.forEach((li) => {
      const ae = document.activeElement;
      if (ae && ae.tagName === "INPUT" && ae.type !== "checkbox" && li.contains(ae)) return; // don't move an amount box while it's being typed in
      const box = li.querySelector("input[type=checkbox]");
      const isDone = !!(box && box.checked);
      const target = isDone ? doneUl : li._home;
      if (li.parentElement !== target) insertOrdered(target, li);
    });
    // Newest tick on top. Only touch the DOM if the order actually changed.
    const rank = (li) => {
      const box = li.querySelector("input[type=checkbox]");
      const t = box ? state.checkedAt[tickKey(box.dataset.list, box.dataset.item)] || 0 : 0;
      return { li, t, o: Number(li.dataset.o) };
    };
    const ordered = [...doneUl.children].map(rank).sort(compareTicked).map((r) => r.li);
    if (ordered.some((li, i) => li !== doneUl.children[i])) ordered.forEach((li) => doneUl.appendChild(li));
    d.querySelectorAll("div.group").forEach((g) => {
      g.hidden = !g.querySelector("li");
    });
    sec.hidden = !doneUl.children.length;
    sec.querySelector(".store").textContent = `Ticked off (${doneUl.children.length})`;
  });
}

let sortTimer = null;
function sortSoon() {
  clearTimeout(sortTimer);
  sortTimer = setTimeout(sortDone, 450); // a short beat so a mis-tick can be undone before the item moves
}

/* ---------- shared data: roster and extras ---------- */

async function loadRoster() {
  state.roster = {};
  state.rosterError = "";
  if (!state.supabase || !state.user) return;
  const { data, error } = await state.supabase.from("roster").select("day,code");
  if (error) {
    state.rosterError = error.message;
    return;
  }
  for (const r of data) state.roster[r.day] = r.code;
}

async function loadExtras() {
  if (!state.supabase || !state.user) {
    state.extras = [];
    state.extrasReady = false;
    state.extrasError = "";
    return;
  }
  const { data, error } = await state.supabase
    .from("shopping_extras")
    .select("id,item,created_at")
    .order("created_at");
  if (error) {
    state.extrasError = error.message;
    state.extrasReady = false;
    return;
  }
  state.extrasError = "";
  state.extras = data;
  state.extrasReady = true;
}

// "How much to buy" overrides, e.g. the plan needs 800 g but 400 g is already at home. Keyed list::item.
const QTY_PREFIX = "hm:qty:";

function loadLocalQty() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(QTY_PREFIX)) {
        const n = Number(localStorage.getItem(k));
        if (Number.isFinite(n)) state.buyQty[k.slice(QTY_PREFIX.length)] = n;
      }
    }
  } catch (e) {
    /* storage unavailable */
  }
}

async function loadRemoteQty() {
  state.buyQtyError = "";
  if (!state.supabase || !state.user) return;
  const { data, error } = await state.supabase.from("meal_buy_qty").select("list_key,item_key,qty");
  if (error) {
    state.buyQtyError = error.message;
    return;
  }
  for (const r of data) state.buyQty[tickKey(r.list_key, r.item_key)] = Number(r.qty);
}

async function setBuyQty(listId, item, planQty, val) {
  const key = tickKey(listId, item.id);
  const reset = val === null || val === planQty;
  if (reset) delete state.buyQty[key];
  else state.buyQty[key] = val;
  try {
    if (reset) localStorage.removeItem(QTY_PREFIX + key);
    else localStorage.setItem(QTY_PREFIX + key, String(val));
  } catch (e) {
    /* ignore */
  }
  if (state.supabase && state.user && !state.buyQtyError) {
    const q = state.supabase.from("meal_buy_qty");
    const { error } = reset
      ? await q.delete().eq("list_key", listId).eq("item_key", item.id)
      : await q.upsert({ list_key: listId, item_key: item.id, qty: val, updated_at: new Date().toISOString() }, { onConflict: "list_key,item_key" });
    if (error) setStatus("Couldn't sync that quantity: " + error.message);
  }
  refreshTicks();
}

async function loadFreezer() {
  state.freezer = [];
  state.freezerReady = false;
  state.freezerError = "";
  if (!state.supabase || !state.user) return;
  const { data, error } = await state.supabase
    .from("meal_freezer")
    .select("id,item,portions,made_on,recipe_key")
    .order("made_on");
  if (error) {
    state.freezerError = error.message;
    return;
  }
  state.freezer = data;
  state.freezerReady = true;
}

async function loadSpend() {
  state.spend = [];
  state.spendReady = false;
  state.spendError = "";
  if (!state.supabase || !state.user) return;
  const { data, error } = await state.supabase
    .from("meal_spend")
    .select("id,spent_on,store,amount,note")
    .order("spent_on", { ascending: false })
    .limit(400);
  if (error) {
    state.spendError = error.message;
    return;
  }
  state.spend = data;
  state.spendReady = true;
}

async function addExtra(text) {
  const { error } = await state.supabase.from("shopping_extras").insert({ item: text });
  if (error) {
    setStatus("Couldn't add that item: " + error.message);
    return;
  }
  await loadExtras();
  drawExtras();
}

async function removeExtra(id) {
  const { error } = await state.supabase.from("shopping_extras").delete().eq("id", id);
  if (error) {
    setStatus("Couldn't remove that item: " + error.message);
    return;
  }
  await state.supabase.from("meal_checks").delete().eq("list_key", "extras").eq("item_key", id);
  delete state.checks[tickKey("extras", id)];
  delete state.checkedAt[tickKey("extras", id)];
  await loadExtras();
  drawExtras();
}

/* ---------- Supabase ---------- */

let channel = null;
let extrasChannel = null;
let freezerChannel = null;
let spendChannel = null;
let qtyChannel = null;

function startRealtime() {
  if (!state.supabase) return;
  if (channel) {
    state.supabase.removeChannel(channel);
    channel = null;
  }
  if (extrasChannel) {
    state.supabase.removeChannel(extrasChannel);
    extrasChannel = null;
  }
  if (freezerChannel) {
    state.supabase.removeChannel(freezerChannel);
    freezerChannel = null;
  }
  if (spendChannel) {
    state.supabase.removeChannel(spendChannel);
    spendChannel = null;
  }
  if (qtyChannel) {
    state.supabase.removeChannel(qtyChannel);
    qtyChannel = null;
  }
  if (!state.user) return;
  channel = state.supabase
    .channel("meal_checks_live")
    .on("postgres_changes", { event: "*", schema: "public", table: "meal_checks" }, (payload) => {
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      if (!row || !row.list_key) return;
      if (payload.eventType === "DELETE") applyRemoteTick({ ...row, checked: false });
      else applyRemoteTick(row);
      refreshTicks();
    })
    .subscribe();
  // Separate channel so a missing extras table can never break tick sync.
  if (!state.buyQtyError) {
    qtyChannel = state.supabase
      .channel("buy_qty_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "meal_buy_qty" }, (payload) => {
        const row = payload.eventType === "DELETE" ? payload.old : payload.new;
        if (!row || !row.list_key) return;
        const key = tickKey(row.list_key, row.item_key);
        if (payload.eventType === "DELETE") delete state.buyQty[key];
        else state.buyQty[key] = Number(row.qty);
        document.querySelectorAll("input.buyqty").forEach((i) => {
          if (i.dataset.key === key && document.activeElement !== i) i.value = state.buyQty[key] ?? i.dataset.plan;
        });
      })
      .subscribe();
  }
  if (state.extrasReady) {
    extrasChannel = state.supabase
      .channel("extras_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_extras" }, async () => {
        await loadExtras();
        drawExtras();
      })
      .subscribe();
  }
  if (state.freezerReady) {
    freezerChannel = state.supabase
      .channel("freezer_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "meal_freezer" }, async () => {
        await loadFreezer();
        drawFreezer();
      })
      .subscribe();
  }
  if (state.spendReady) {
    spendChannel = state.supabase
      .channel("spend_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "meal_spend" }, async () => {
        await loadSpend();
        drawSpend();
      })
      .subscribe();
  }
}

async function loadSharedData() {
  await Promise.all([loadRemoteChecks(), loadRemoteQty(), loadRoster(), loadExtras(), loadFreezer(), loadSpend()]);
}

async function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    state.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await state.supabase.auth.getSession();
    state.user = data.session ? data.session.user : null;
    state.supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session ? session.user : null;
      const changed = (nextUser && nextUser.id) !== (state.user && state.user.id);
      state.user = nextUser;
      if (!changed) return;
      // Avoid calling Supabase inside this callback directly.
      setTimeout(async () => {
        await loadSharedData();
        startRealtime();
        updateNav();
        route();
      }, 0);
    });
  } catch (e) {
    console.warn("Supabase unavailable, ticks stay on this device.", e);
    state.supabase = null;
  }
}

function updateNav() {
  navAccount.textContent = state.user ? "Account" : "Log in";
}

/* ---------- shared pieces ---------- */

function chips(list) {
  return h(
    "div",
    { class: "chips" },
    (list || []).map((a) => h("span", { class: "chip" }, ALLERGENS[a] || a))
  );
}

function shiftChip(iso) {
  const code = state.roster[iso];
  if (!code) return null;
  const s = SHIFTS[code] || { label: code, cls: "" };
  return h("span", { class: `shift shift-${s.cls}`, title: code }, s.label);
}

function dayAllergens(day) {
  const set = new Set();
  for (const id of [day.breakfast, day.dinner]) {
    const r = id && state.byId[id];
    if (r) r.allergens.forEach((a) => set.add(a));
  }
  return [...set];
}

function recipeLink(id, short) {
  const r = state.byId[id];
  if (!r) return null;
  return h("a", { href: `#/recipe/${id}` }, short ? r.short || r.title : r.title);
}

/* ---------- weather (Sydney forecast, Open-Meteo; hot above 27 C, cold below 15 C) ---------- */

const FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=-33.87&longitude=151.21&daily=temperature_2m_max&hourly=temperature_2m&timezone=Australia%2FSydney&forecast_days=7";

async function loadWeather() {
  try {
    // show the last forecast straight away, then refresh it
    const cached = JSON.parse(localStorage.getItem("wxCache") || "null");
    if (cached && cached.data) state.weather = cached.data;
  } catch (e) {}
  try {
    const r = await fetch(FORECAST_URL);
    if (!r.ok) throw new Error(r.status);
    state.weather = parseForecast(await r.json());
    try {
      localStorage.setItem("wxCache", JSON.stringify({ data: state.weather }));
    } catch (e) {}
  } catch (e) {
    return; // no forecast: keep whatever we have, or show no weather notes
  }
  if (state.plan.length) route(false);
}

function weatherChip(iso) {
  const w = state.weather[iso];
  const kind = classifyNight(w);
  if (!kind) return null;
  return h(
    "span",
    { class: `wx wx-${kind}`, title: "Sydney forecast" },
    kind === "hot" ? `Hot night ${Math.round(w.max)}\u00b0` : `Cool night ${Math.round(w.evening)}\u00b0`
  );
}

// Chip plus a swap prompt when the dish is the wrong temperature for the forecast. The site only suggests.
function weatherNote(iso) {
  const w = state.weather[iso];
  const kind = classifyNight(w);
  if (!kind) return null;
  const day = state.plan.find((d) => d.date === iso);
  const dish = day && day.dinner && state.byId[day.dinner];
  const swap = suggestSwap(state.plan, state.byId, iso, kind);
  const line = kind === "hot" ? "Hot night forecast" : "Cool night forecast";
  const note = swap
    ? `${line}: swap with ${fmtDate(swap.date)} (${state.byId[swap.dinner].title})? Tell Claude and the shopping list gets rebuilt.`
    : dish && dish.temp === (kind === "hot" ? "hot" : "cool")
      ? `${line}, and no better-suited dinner is planned in the next week.`
      : null;
  return note ? h("p", { class: `note wx-note wx-${kind}` }, note) : null;
}

function dayCard(day) {
  return h(
    "article",
    { class: "card" },
    h("h3", null, fmtDate(day.date), " ", shiftChip(day.date), " ", weatherChip(day.date)),
    day.breakfast ? h("p", null, h("span", { class: "label" }, "Baby breakfast"), recipeLink(day.breakfast)) : null,
    day.dinner ? h("p", null, h("span", { class: "label" }, "Dinner"), recipeLink(day.dinner)) : null,
    chips(dayAllergens(day)),
    weatherNote(day.date),
    day.note ? h("p", { class: "note" }, day.note) : null
  );
}

/* ---------- views ---------- */

function fmtMoney(n) {
  return "$" + Number(n).toFixed(2);
}

// Freezer vs the next run of night shifts (one packed meal per night). compact = Today page version.
function nightBanner(compact) {
  if (!state.supabase) return null;
  const quiet = (msg) => (compact ? null : h("p", { class: "muted" }, msg));
  if (!state.user) return quiet("Log in to see your night runs.");
  if (!Object.keys(state.roster).length) return quiet("No shifts loaded yet, so night runs can't be worked out.");
  const st = nightRunStatus(state.roster, state.freezerReady ? state.freezer : [], localISO());
  if (!st) return quiet("No night runs on the roster in the next 90 days.");
  if (compact && st.startsInDays > 21) return null;
  const when = st.underway
    ? "Night run under way"
    : st.startsInDays === 0
      ? "Night run starts today"
      : `Night run in ${st.startsInDays} day${st.startsInDays === 1 ? "" : "s"}`;
  const nights = `${st.run.nights} night${st.run.nights === 1 ? "" : "s"}`;
  let line;
  let cls = "banner";
  if (!state.freezerReady) {
    line = "The freezer page isn't set up yet, so portions can't be counted.";
  } else if (st.short === 0) {
    line = `${st.portions} freezer portion${st.portions === 1 ? "" : "s"} for ${nights}. Covered.`;
    cls += " ok";
  } else {
    line = `${st.portions} freezer portion${st.portions === 1 ? "" : "s"} for ${nights}. Cook ${st.short} more.`;
    cls += " warn";
  }
  return h(
    "a",
    { class: cls, href: "#/freezer" },
    h("strong", null, when),
    ` (${fmtDate(st.run.start)}${st.run.end !== st.run.start ? " to " + fmtDate(st.run.end) : ""})`,
    h("span", null, line)
  );
}

function prepList(groups) {
  return groups.map((g) =>
    h("div", { class: "prep" }, h("div", { class: "store" }, g.label), h("ul", null, g.items.map((i) => h("li", null, i.text))))
  );
}

function tonightCard(day) {
  const dinner = day.dinner ? state.byId[day.dinner] : null;
  const breakfast = day.breakfast ? state.byId[day.breakfast] : null;
  const advice = shiftAdvice(state.roster[day.date]);
  return h(
    "article",
    { class: "card" },
    h("h3", null, fmtDate(day.date), " ", shiftChip(day.date), " ", weatherChip(day.date)),
    advice ? h("p", { class: "advice" }, advice) : null,
    day.jamesMeal ? h("p", null, h("span", { class: "label" }, "Your meal"), day.jamesMeal) : null,
    breakfast ? h("p", null, h("span", { class: "label" }, "Baby breakfast"), recipeLink(day.breakfast)) : null,
    dinner ? h("p", null, h("span", { class: "label" }, "Dinner"), recipeLink(day.dinner)) : null,
    dinner ? h("p", { class: "note" }, `${dinner.time} | ${dinner.serves}`) : null,
    dinner && dinner.baby ? h("div", { class: "baby" }, h("strong", null, "Baby version: "), dinner.baby) : null,
    chips(dayAllergens(day)),
    prepList(groupPrep(day.prep).filter((g) => g.when !== "night-before")),
    weatherNote(day.date),
    day.note ? h("p", { class: "note" }, day.note) : null
  );
}

function tomorrowCard(day) {
  const setup = groupPrep(day.prep).filter((g) => g.when === "night-before");
  return h(
    "article",
    { class: "card" },
    h("h3", null, "Tomorrow: ", fmtDate(day.date), " ", shiftChip(day.date), " ", weatherChip(day.date)),
    day.breakfast ? h("p", null, h("span", { class: "label" }, "Baby breakfast"), recipeLink(day.breakfast)) : null,
    day.dinner ? h("p", null, h("span", { class: "label" }, "Dinner"), recipeLink(day.dinner)) : null,
    weatherNote(day.date),
    prepList(setup)
  );
}

function viewToday() {
  if (!state.plan.length) return h("p", { class: "muted" }, "No plan loaded yet.");
  const today = localISO();
  let day = state.plan.find((d) => d.date === today);
  let heading = "Tonight";
  if (!day) {
    day = state.plan.find((d) => d.date > today);
    heading = "Next up";
    if (!day) {
      day = state.plan[state.plan.length - 1];
      heading = "Latest planned day";
    }
  }
  const tomorrow = day.date === today ? state.plan.find((d) => d.date === addDaysISO(today, 1)) : null;
  const hint =
    state.supabase && !state.user ? h("p", { class: "muted" }, "Log in to see your shift and night runs here.") : null;
  return h(
    "section",
    null,
    h("h2", null, heading),
    nightBanner(true),
    hint,
    tonightCard(day),
    tomorrow ? tomorrowCard(tomorrow) : null,
    h("p", { class: "muted" }, h("a", { href: "#/plan" }, "See the full plan and calendar"))
  );
}

function viewCalendar() {
  const dates = [...state.plan.map((d) => d.date), ...Object.keys(state.roster)].sort();
  if (!dates.length) return null;
  const today = localISO();
  const byDate = Object.fromEntries(state.plan.map((d) => [d.date, d]));
  const lastMonday = mondayOf(dates[dates.length - 1]);
  const weeks = [];
  for (let w = mondayOf(dates[0]); w <= lastMonday; w = addDays(w, 7)) {
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const dt = addDays(w, i);
      const iso = localISO(dt);
      const p = byDate[iso];
      const weekend = dt.getDay() === 0 || dt.getDay() === 6;
      cells.push(
        h(
          "div",
          { class: "cal-cell" + (iso === today ? " today" : "") + (weekend ? " weekend" : "") },
          h(
            "div",
            { class: "cal-date" },
            dt.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" }),
            " ",
            shiftChip(iso),
            " ",
            weatherChip(iso)
          ),
          p && p.breakfast
            ? h("div", { class: "cal-meal" }, h("span", { class: "label" }, "Baby"), recipeLink(p.breakfast, true))
            : null,
          p && p.dinner
            ? h("div", { class: "cal-meal" }, h("span", { class: "label" }, "Dinner"), recipeLink(p.dinner, true))
            : null
        )
      );
    }
    weeks.push(
      h(
        "div",
        { class: "cal-week-wrap" },
        h("div", { class: "cal-week-title" }, "Week of " + fmtDate(localISO(w))),
        h("div", { class: "cal-week" }, cells)
      )
    );
  }
  let hint = null;
  if (state.supabase && !state.user) hint = "Log in to see your shifts on the calendar.";
  else if (state.rosterError) hint = "Shifts aren't set up yet. Run the roster SQL in Supabase.";
  else if (state.supabase && state.user && !Object.keys(state.roster).length) hint = "No shifts loaded yet.";
  return h(
    "section",
    null,
    h("h2", null, "Calendar"),
    hint ? h("p", { class: "muted" }, hint) : null,
    weeks,
    h("p", { class: "note" }, "Shifts: Day, Eve (evening), Night, On call, ADO (accrued day off). +T means teaching.")
  );
}

function viewPlan(planNote) {
  return h(
    "section",
    null,
    viewCalendar(),
    h("h2", null, "Day by day"),
    planNote ? h("p", { class: "muted" }, planNote) : null,
    state.plan.map(dayCard)
  );
}

function recipeCard(r) {
  return h(
    "article",
    { class: "card" },
    h("h3", null, h("a", { href: `#/recipe/${r.id}` }, r.title)),
    h("p", { class: "note" }, `${r.cuisine} | ${r.time}`),
    chips(r.allergens)
  );
}

function viewRecipes() {
  const list = h("div", null);
  const draw = () => {
    const { type, q } = state.recipeFilter;
    const needle = q.trim().toLowerCase();
    const rows = state.recipes.filter(
      (r) =>
        (type === "all" || r.type === type) &&
        (!needle || (r.title + " " + r.cuisine + " " + r.ingredients.join(" ")).toLowerCase().includes(needle))
    );
    list.replaceChildren(...(rows.length ? rows.map(recipeCard) : [h("p", { class: "muted" }, "No recipes match.")]));
  };
  const tabs = h("div", { class: "tabs" });
  const drawTabs = () => {
    tabs.replaceChildren(
      ...[
        ["all", "All"],
        ["dinner", "Dinners"],
        ["breakfast", "Baby breakfasts"],
        ["basics", "Basics"],
      ].map(([val, label]) =>
        h(
          "button",
          {
            type: "button",
            class: state.recipeFilter.type === val ? "" : "off",
            onclick: () => {
              state.recipeFilter.type = val;
              drawTabs();
              draw();
            },
          },
          label
        )
      )
    );
  };
  const search = h("input", {
    type: "search",
    placeholder: "Search recipes or ingredients",
    value: state.recipeFilter.q,
    oninput: (e) => {
      state.recipeFilter.q = e.target.value;
      draw();
    },
  });
  drawTabs();
  draw();
  return h("section", null, h("h2", null, "Recipes"), search, tabs, list);
}

function viewRecipe(id) {
  const r = state.byId[id];
  if (!r) return h("p", { class: "error" }, "Recipe not found.");
  const notesBox = h("div", null);
  const view = h(
    "section",
    null,
    h("p", null, h("a", { href: "#/recipes" }, "< All recipes")),
    h("h2", null, r.title),
    h("p", { class: "note" }, `${r.cuisine} | ${r.time} | ${r.serves}`),
    chips(r.allergens),
    r.iron ? h("p", { class: "note" }, "Iron: " + r.iron) : null,
    h("h3", null, "Ingredients"),
    h("ul", null, r.ingredients.map((i) => h("li", null, i))),
    h("h3", null, "Method"),
    h("ol", { class: "steps" }, r.steps.map((s) => h("li", null, s))),
    h("div", { class: "card" }, h("h3", null, "Baby version"), h("p", null, r.baby)),
    r.notes ? h("p", { class: "note" }, r.notes) : null,
    h("h3", null, "Notes"),
    notesBox
  );
  if (state.supabase && state.user) loadNotes(id, notesBox);
  else notesBox.append(h("p", { class: "muted" }, "Log in to see and add shared notes."));
  return view;
}

async function loadNotes(recipeId, box) {
  box.replaceChildren(h("p", { class: "muted" }, "Loading notes..."));
  const { data, error } = await state.supabase
    .from("meal_notes")
    .select("id,note,created_at")
    .eq("recipe_key", recipeId)
    .order("created_at");
  if (error) {
    box.replaceChildren(h("p", { class: "error" }, "Couldn't load notes: " + error.message));
    return;
  }
  const items = data.length
    ? data.map((n) => h("p", { class: "note-item" }, n.note))
    : [h("p", { class: "muted" }, "No notes yet.")];
  box.replaceChildren(...items, noteForm(recipeId, box));
}

function noteForm(recipeId, box) {
  const input = h("input", {
    type: "text",
    placeholder: "Add a note, e.g. less chilli next time",
    maxlength: "300",
  });
  return h(
    "form",
    {
      class: "row",
      onsubmit: async (e) => {
        e.preventDefault();
        const note = input.value.trim();
        if (!note) return;
        const { error } = await state.supabase.from("meal_notes").insert({ recipe_key: recipeId, note });
        if (error) {
          setStatus("Couldn't save the note: " + error.message);
          return;
        }
        loadNotes(recipeId, box);
      },
    },
    input,
    h("button", { type: "submit" }, "Add")
  );
}

// Double-tap (or double-click) anywhere on a row to tick it, so a stray touch while scrolling does nothing.
// Space or Enter on a focused row does the same for keyboard users. The amount box and buttons are left alone.
function tickItem(listId, item, extra, opts = {}) {
  const cb = h("input", {
    type: "checkbox",
    class: "tickbox",
    tabindex: "-1",
    "aria-hidden": "true",
    "data-list": listId,
    "data-item": item.id,
    checked: isChecked(listId, item.id),
    onclick: (e) => e.preventDefault(),
  });
  const q = opts.qty || null;
  let lastTap = null;
  let armTimer = null;
  const li = h(
    "li",
    {
      class: "tickrow",
      role: "checkbox",
      tabindex: "0",
      "aria-checked": String(isChecked(listId, item.id)),
      title: "Double-tap to tick off",
      onclick: (e) => {
        if (e.target.closest("input.buyqty, button, a, .qty")) {
          lastTap = null;
          return;
        }
        const cur = { t: Date.now(), x: e.clientX, y: e.clientY };
        if (isDoubleTap(lastTap, cur)) {
          lastTap = null;
          li.classList.remove("armed");
          toggleTick(listId, item.id);
        } else {
          lastTap = cur;
          li.classList.add("armed"); // first tap registered; a second one ticks it
          clearTimeout(armTimer);
          armTimer = setTimeout(() => li.classList.remove("armed"), 450);
        }
      },
      onkeydown: (e) => {
        if (e.target !== li || (e.key !== " " && e.key !== "Enter")) return;
        e.preventDefault();
        toggleTick(listId, item.id);
      },
    },
    cb,
    h("label", null, q ? q.name : item.text, q && q.note ? h("span", { class: "note itemnote" }, q.note) : null),
    q ? qtyEditor(listId, item, q) : null,
    extra || null
  );
  return li;
}

// Editable "buy" amount. The plan's number stays visible when you've changed it.
function qtyEditor(listId, item, q) {
  const key = tickKey(listId, item.id);
  const current = state.buyQty[key] ?? q.qty;
  const unit = q.unit ? " " + q.unit : "";
  const plan = h("span", { class: "note planqty" }, current !== q.qty ? `plan: ${q.qty}${unit}` : "");
  const input = h("input", {
    type: "number",
    class: "buyqty",
    min: "0",
    step: "any",
    inputmode: "decimal",
    value: String(current),
    "data-key": key,
    "data-plan": String(q.qty),
    "aria-label": `Amount to buy of ${q.name}`,
    onchange: async (e) => {
      const raw = e.target.value.trim();
      const n = raw === "" ? q.qty : Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        e.target.value = String(state.buyQty[key] ?? q.qty);
        return;
      }
      await setBuyQty(listId, item, q.qty, n);
      plan.textContent = n !== q.qty ? `plan: ${q.qty}${unit}` : "";
    },
  });
  return h("span", { class: "qty" }, input, h("span", { class: "unit" }, q.unit || ""), plan);
}

/* Extras: household items that aren't part of the meal plan */

function extrasContent() {
  if (!state.supabase) return [h("p", { class: "muted" }, "Extras need shared sync to be switched on.")];
  if (!state.user) return [h("p", { class: "muted" }, "Log in to add household items like cleaning supplies.")];
  if (state.extrasError) {
    return [h("p", { class: "error" }, "Extras aren't set up yet. Run the extras SQL in Supabase. (" + state.extrasError + ")")];
  }
  const input = h("input", {
    type: "text",
    placeholder: "Add an item, e.g. dishwasher tablets",
    maxlength: "200",
    "aria-label": "New shopping item",
  });
  const form = h(
    "form",
    {
      class: "row",
      onsubmit: async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        await addExtra(text);
      },
    },
    input,
    h("button", { type: "submit" }, "Add")
  );
  const clear = state.extras.some((x) => isChecked("extras", x.id))
    ? h(
        "button",
        {
          type: "button",
          class: "secondary",
          onclick: async () => {
            for (const x of state.extras.filter((y) => isChecked("extras", y.id))) await removeExtra(x.id);
          },
        },
        "Remove ticked items"
      )
    : null;
  return [form, clear];
}

// Extras are shown inside the current list, so adding or removing one redraws the whole page.
// Keep whichever lists were open.
function drawExtras() {
  if (!location.hash.startsWith("#/shopping")) return;
  const open = new Set([...document.querySelectorAll("details[data-list][open]")].map((d) => d.dataset.list));
  route(false);
  document.querySelectorAll("details[data-list]").forEach((d) => {
    d.open = open.has(d.dataset.list);
  });
  refreshTicks();
}

// A list's items in store-walk order, with the extras slotted into the matching section
// (or "Other" if the aisle can't be guessed). Only the current list gets the extras.
function groupsFor(list, withExtras) {
  const items = list.items.map((it) => ({ ...it }));
  if (withExtras) {
    for (const x of state.extras) {
      items.push({ id: x.id, text: x.item, extra: true, section: sectionForAisle(classifyExtra(x.item)) });
    }
  }
  return buildGroups(items, state.layout);
}

function extraRemoveBtn(x) {
  return h(
    "button",
    { type: "button", class: "secondary small", "aria-label": "Remove " + x.text, onclick: () => removeExtra(x.id) },
    "Remove"
  );
}

// Anything still unticked on the previous list, once its shop day has passed.
function carriedOver(idx) {
  const prev = state.shopping[idx - 1];
  if (!prev || !prev.buyDate || prev.buyDate >= localISO()) return null;
  const left = [];
  for (const g of buildGroups(prev.items, state.layout))
    for (const it of g.items) {
      if (isChecked(prev.id, it.id)) continue;
      left.push({ id: it.id, text: `${it.text} (${g.store})` });
    }
  if (!left.length) return null;
  return h(
    "div",
    null,
    h("div", { class: "store" }, `Carried over from ${prev.title}`),
    h("ul", { class: "ticks" }, left.map((it) => tickItem(prev.id, it)))
  );
}

function viewShopping() {
  const note = state.supabase
    ? state.user
      ? "Double-tap an item to tick it off. Ticks sync live between your phones."
      : "Double-tap an item to tick it off. Log in so ticks sync between your phones; until then they save on this device only."
    : "Double-tap an item to tick it off. Ticks save on this device only.";
  return h(
    "section",
    null,
    h("h2", null, "Shopping"),
    h("p", { class: "muted" }, note),
    state.layout.note ? h("p", { class: "muted" }, state.layout.note) : null,
    state.shopping.map((list, idx) => {
      const isCurrent = idx === currentListIndex(state.shopping, localISO());
      const groups = groupsFor(list, isCurrent);
      return h(
        "details",
        { class: "list card", "data-list": list.id, open: isCurrent },
        h("summary", null, `${list.title}: ${list.buy}`, h("span", { class: "progress" })),
        h("p", { class: "note" }, `Covers ${list.covers}. ${list.estimate}`),
        carriedOver(idx),
        groups.map((g) =>
          h(
            "div",
            { class: "group" },
            h("div", { class: "store" }, g.store),
            h(
              "ul",
              { class: "ticks" },
              g.items.map((it) =>
                it.extra
                  ? tickItem("extras", it, extraRemoveBtn(it))
                  : tickItem(list.id, it, null, { qty: parseQty(it.text) })
              )
            )
          )
        ),
        h(
          "button",
          {
            type: "button",
            class: "secondary clear-ticks",
            onclick: async () => {
              if (!window.confirm("Clear all ticks on " + list.title + "?")) return;
              for (const it of list.items) {
                if (isChecked(list.id, it.id)) await setChecked(list.id, it.id, false);
              }
              refreshTicks();
            },
          },
          "Clear ticks"
        )
      );
    }),
    h(
      "details",
      { class: "list card", "data-list": "extras", open: true },
      h("summary", null, "Extras and one-off items", h("span", { class: "progress" })),
      h("p", { class: "note" }, "Add anything that isn't on the lists: a forgotten ingredient, cleaning supplies, toiletries. It lands in this week's list under the matching aisle, or under Household and other if I can't tell. Either of you can add from your phone."),
      h("div", { id: "extras-box" }, extrasContent().filter(Boolean))
    )
  );
}

/* Freezer inventory */

function notReady(name, ready, error, sqlName) {
  if (!state.supabase) return [h("p", { class: "muted" }, `${name} needs shared sync to be switched on.`)];
  if (!state.user) return [h("p", { class: "muted" }, `Log in to see and update the ${name.toLowerCase()}.`)];
  if (error) {
    return [
      h("p", { class: "error" }, `${name} isn't set up yet. Run sql/${sqlName} in Supabase, then refresh. (${error})`),
    ];
  }
  return null;
}

async function adjustFreezer(it, delta) {
  const next = Number(it.portions) + delta;
  const { error } =
    next <= 0
      ? await state.supabase.from("meal_freezer").delete().eq("id", it.id)
      : await state.supabase.from("meal_freezer").update({ portions: next }).eq("id", it.id);
  if (error) setStatus("Couldn't update the freezer: " + error.message);
  await loadFreezer();
  drawFreezer();
}

async function removeFreezer(it) {
  if (!window.confirm(`Remove ${it.item} from the freezer list?`)) return;
  const { error } = await state.supabase.from("meal_freezer").delete().eq("id", it.id);
  if (error) setStatus("Couldn't remove that: " + error.message);
  await loadFreezer();
  drawFreezer();
}

function freezerRow(it, today) {
  const age = ageDays(it.made_on, today);
  const oldish = age >= 90;
  return h(
    "article",
    { class: "card" },
    h("h3", null, it.item, " ", h("span", { class: "chip" }, `${it.portions} portion${it.portions === 1 ? "" : "s"}`)),
    h(
      "p",
      { class: "note" },
      `Made ${fmtDate(it.made_on)} (${age <= 0 ? "today" : age === 1 ? "yesterday" : age + " days ago"})`,
      oldish ? " | Use soon: over 3 months" : ""
    ),
    h(
      "div",
      { class: "row" },
      h(
        "button",
        { type: "button", class: "secondary small", onclick: () => adjustFreezer(it, -1) },
        it.portions <= 1 ? "Used the last one" : "Used one"
      ),
      h("button", { type: "button", class: "secondary small", onclick: () => adjustFreezer(it, 1) }, "Add one"),
      h("button", { type: "button", class: "secondary small", onclick: () => removeFreezer(it) }, "Remove")
    )
  );
}

function freezerContent() {
  const blocked = notReady("Freezer", state.freezerReady, state.freezerError, "2026-11-freezer-and-spend.sql");
  if (blocked) return blocked;
  const today = localISO();
  return [
    nightBanner(false),
    h(
      "p",
      { class: "muted" },
      `${freezerSummary(state.freezer)} portion${freezerSummary(state.freezer) === 1 ? "" : "s"} in the freezer. Count adult-sized portions that you can take to work.`
    ),
    state.freezer.length ? state.freezer.map((it) => freezerRow(it, today)) : h("p", { class: "muted" }, "Nothing in the freezer yet."),
    h("p", { class: "note" }, "The 3 month flag is a rough quality guide only, not a food safety rule."),
  ];
}

function drawFreezer() {
  const box = document.getElementById("freezer-box");
  if (box) box.replaceChildren(...freezerContent().flat().filter(Boolean));
}

function freezerForm() {
  const item = h("input", {
    type: "text",
    placeholder: "What is it? e.g. Red lentil dahl",
    maxlength: "120",
    required: true,
    list: "freezer-recipes",
    "aria-label": "Freezer item",
  });
  const portions = h("input", { type: "number", min: "1", max: "50", value: "2", "aria-label": "Portions" });
  const made = h("input", { type: "date", value: localISO(), "aria-label": "Date made" });
  const titles = state.recipes.filter((r) => r.type === "dinner" || r.type === "basics");
  return h(
    "form",
    {
      class: "card",
      onsubmit: async (e) => {
        e.preventDefault();
        const text = item.value.trim();
        const n = parseInt(portions.value, 10);
        if (!text || !(n >= 1 && n <= 50)) return;
        const match = titles.find((r) => r.title.toLowerCase() === text.toLowerCase());
        const { error } = await state.supabase
          .from("meal_freezer")
          .insert({ item: text, portions: n, made_on: made.value || localISO(), recipe_key: match ? match.id : null });
        if (error) {
          setStatus("Couldn't add that: " + error.message);
          return;
        }
        item.value = "";
        await loadFreezer();
        drawFreezer();
      },
    },
    h("h3", null, "Add to the freezer"),
    h("datalist", { id: "freezer-recipes" }, titles.map((r) => h("option", { value: r.title }))),
    item,
    h("div", { class: "row" }, h("label", { class: "inline" }, "Portions", portions), h("label", { class: "inline" }, "Made", made)),
    h("button", { type: "submit" }, "Add")
  );
}

function viewFreezer() {
  return h(
    "section",
    null,
    h("h2", null, "Freezer"),
    state.freezerReady ? freezerForm() : null,
    h("div", { id: "freezer-box" }, freezerContent().flat().filter(Boolean))
  );
}

/* Grocery spend */

const SPEND_STORES = ["Woolworths", "Butcher", "Fruit grocer", "Seafood", "Other"];

async function removeSpend(e) {
  if (!window.confirm(`Remove ${fmtMoney(e.amount)} at ${e.store}?`)) return;
  const { error } = await state.supabase.from("meal_spend").delete().eq("id", e.id);
  if (error) setStatus("Couldn't remove that: " + error.message);
  await loadSpend();
  drawSpend();
}

function spendContent() {
  const blocked = notReady("Spend tracker", state.spendReady, state.spendError, "2026-11-freezer-and-spend.sql");
  if (blocked) return blocked;
  const today = localISO();
  const fn = fortnightFor(today, state.spendOffset);
  const sum = summariseSpend(state.spend, fn, FORTNIGHT_BUDGET, today);
  const stepper = h(
    "div",
    { class: "row" },
    h(
      "button",
      {
        type: "button",
        class: "secondary small",
        onclick: () => {
          state.spendOffset -= 1;
          drawSpend();
        },
      },
      "< Earlier"
    ),
    h("span", { class: "grow" }, `${fmtDate(fn.start)} to ${fmtDate(fn.end)}${sum.isCurrent ? " (this fortnight)" : ""}`),
    h(
      "button",
      {
        type: "button",
        class: "secondary small",
        disabled: state.spendOffset >= 0,
        onclick: () => {
          state.spendOffset += 1;
          drawSpend();
        },
      },
      "Later >"
    )
  );
  const stores = Object.entries(sum.byStore).sort((a, b) => b[1] - a[1]);
  const status = sum.over
    ? `${fmtMoney(-sum.remaining)} over budget`
    : `${fmtMoney(sum.remaining)} left`;
  const pace = sum.isCurrent
    ? `Day ${sum.dayNumber} of 14. An even pace would be about ${fmtMoney(sum.paceTarget)} by today${
        sum.total > sum.paceTarget ? ", so you're running ahead of it." : "."
      }`
    : null;
  return [
    stepper,
    h(
      "div",
      { class: "card" },
      h("div", { class: "big" }, fmtMoney(sum.total), h("span", { class: "muted" }, ` of ${fmtMoney(FORTNIGHT_BUDGET)}`)),
      h("div", { class: "bar" + (sum.over ? " over" : "") }, h("span", { style: `width:${sum.pct}%` })),
      h("p", null, status),
      pace ? h("p", { class: "note" }, pace) : null,
      stores.length
        ? h("ul", { class: "plain" }, stores.map(([name, amt]) => h("li", null, `${name}: ${fmtMoney(amt)}`)))
        : null
    ),
    sum.entries.length
      ? sum.entries.map((e) =>
          h(
            "article",
            { class: "card spend-row" },
            h("div", null, h("strong", null, fmtMoney(e.amount)), ` ${e.store}`, h("div", { class: "note" }, fmtDate(e.spent_on) + (e.note ? " | " + e.note : ""))),
            h("button", { type: "button", class: "secondary small", "aria-label": "Remove entry", onclick: () => removeSpend(e) }, "Remove")
          )
        )
      : h("p", { class: "muted" }, "Nothing logged for this fortnight yet."),
    h(
      "p",
      { class: "note" },
      "Counts all family groceries, not just the meal lists. Fortnights run Wednesday to Tuesday, from the first shop day of each plan."
    ),
  ];
}

function drawSpend() {
  const box = document.getElementById("spend-box");
  if (box) box.replaceChildren(...spendContent().flat().filter(Boolean));
}

function spendForm() {
  const date = h("input", { type: "date", value: localISO(), required: true, "aria-label": "Date" });
  const store = h(
    "select",
    { "aria-label": "Store" },
    SPEND_STORES.map((n) => h("option", { value: n }, n))
  );
  const amount = h("input", {
    type: "text",
    inputmode: "decimal",
    placeholder: "Total, e.g. 182.40",
    required: true,
    "aria-label": "Amount in dollars",
  });
  const note = h("input", { type: "text", placeholder: "Note (optional)", maxlength: "200", "aria-label": "Note" });
  return h(
    "form",
    {
      class: "card",
      onsubmit: async (e) => {
        e.preventDefault();
        const n = Math.round(Number(amount.value.replace(/[$,\s]/g, "")) * 100) / 100;
        if (!Number.isFinite(n) || n <= 0 || n >= 5000) {
          setStatus("Enter the shop total as a dollar amount, like 182.40.");
          return;
        }
        const when = date.value || localISO();
        const { error } = await state.supabase
          .from("meal_spend")
          .insert({ spent_on: when, store: store.value, amount: n, note: note.value.trim() || null });
        if (error) {
          setStatus("Couldn't save that: " + error.message);
          return;
        }
        amount.value = "";
        note.value = "";
        // Jump to the fortnight the entry landed in so you can see it.
        state.spendOffset = diffDays(fortnightFor(when).start, fortnightFor(localISO()).start) / 14;
        await loadSpend();
        drawSpend();
      },
    },
    h("h3", null, "Log a shop"),
    h("div", { class: "row" }, date, store),
    h("div", { class: "row" }, amount),
    h("div", { class: "row" }, note),
    h("button", { type: "submit" }, "Add")
  );
}

function viewSpend() {
  state.spendOffset = Math.min(state.spendOffset, 0);
  return h(
    "section",
    null,
    h("h2", null, "Spend"),
    state.spendReady ? spendForm() : null,
    h("div", { id: "spend-box" }, spendContent().flat().filter(Boolean))
  );
}

function viewAccount() {
  if (!state.supabase) {
    return h(
      "section",
      null,
      h("h2", null, "Account"),
      h("p", { class: "muted" }, "Shared sync isn't switched on yet. Ticks save on this device only.")
    );
  }
  if (state.user) {
    return h(
      "section",
      null,
      h("h2", null, "Account"),
      h("p", null, "You're logged in. Ticks, extras, notes, shifts, freezer and spend sync live."),
      h(
        "button",
        {
          type: "button",
          onclick: async () => {
            await state.supabase.auth.signOut();
            location.hash = "#/today";
          },
        },
        "Log out"
      )
    );
  }
  const email = h("input", { type: "email", id: "email", autocomplete: "username", required: true });
  const pass = h("input", { type: "password", id: "pass", autocomplete: "current-password", required: true });
  const err = h("p", { class: "error" });
  return h(
    "section",
    null,
    h("h2", null, "Log in"),
    h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = "";
          const { error } = await state.supabase.auth.signInWithPassword({
            email: email.value.trim(),
            password: pass.value,
          });
          if (error) err.textContent = error.message;
          else location.hash = "#/shopping";
        },
      },
      h("label", { for: "email" }, "Email"),
      email,
      h("label", { for: "pass" }, "Password"),
      pass,
      h("p", null, h("button", { type: "submit" }, "Log in")),
      err
    )
  );
}

/* ---------- router ---------- */

let planNote = "";

function route(scrollTop) {
  const hash = location.hash.replace(/^#\/?/, "") || "today";
  const [page, arg] = hash.split("/");
  let view;
  switch (page) {
    case "plan":
      view = viewPlan(planNote);
      break;
    case "recipes":
      view = viewRecipes();
      break;
    case "recipe":
      view = viewRecipe(arg);
      break;
    case "shopping":
      view = viewShopping();
      break;
    case "freezer":
      view = viewFreezer();
      break;
    case "spend":
      view = viewSpend();
      break;
    case "account":
      view = viewAccount();
      break;
    default:
      view = viewToday();
  }
  app.replaceChildren(view);
  document.querySelectorAll("#nav a").forEach((a) => {
    const p = a.dataset.page;
    a.classList.toggle("active", p === page || (p === "recipes" && page === "recipe"));
  });
  if (scrollTop) window.scrollTo(0, 0);
  updateProgress();
}

/* ---------- start ---------- */

async function init() {
  loadWeather();
  try {
    const [recipes, plan, shopping, layout] = await Promise.all([
      loadJSON("data/recipes.json"),
      loadJSON("data/plan.json"),
      loadJSON("data/shopping.json"),
      loadJSON("data/store-layout.json"),
    ]);
    state.recipes = recipes;
    state.byId = Object.fromEntries(recipes.map((r) => [r.id, r]));
    state.plan = plan.days;
    planNote = plan.note || "";
    state.shopping = shopping;
    state.layout = layout;
  } catch (e) {
    app.replaceChildren(h("p", { class: "error" }, "Couldn't load the meal data. Try refreshing."));
    return;
  }
  loadLocalChecks();
  loadLocalQty();
  await initSupabase();
  await loadSharedData();
  startRealtime();
  updateNav();
  window.addEventListener("hashchange", () => route(true));
  route(false);
}

init();
