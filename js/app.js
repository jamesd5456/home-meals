import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const app = document.getElementById("app");
const statusEl = document.getElementById("status");
const navAccount = document.getElementById("nav-account");

const state = {
  recipes: [],
  byId: {},
  plan: [],
  shopping: [],
  supabase: null,
  user: null,
  checks: {},
  extras: [],
  extrasReady: false,
  extrasError: "",
  roster: {},
  rosterError: "",
  recipeFilter: { type: "all", q: "" },
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
    .select("list_key,item_key,checked");
  if (error) {
    setStatus("Couldn't load shared ticks: " + error.message);
    return;
  }
  for (const r of data) state.checks[tickKey(r.list_key, r.item_key)] = !!r.checked;
}

async function setChecked(list, item, val) {
  const key = tickKey(list, item);
  state.checks[key] = val;
  try {
    localStorage.setItem(LS_PREFIX + key, val ? "1" : "0");
  } catch (e) {
    /* ignore */
  }
  if (state.supabase && state.user) {
    const { error } = await state.supabase.from("meal_checks").upsert(
      { list_key: list, item_key: item, checked: val, updated_at: new Date().toISOString() },
      { onConflict: "list_key,item_key" }
    );
    if (error) setStatus("Couldn't sync that tick: " + error.message);
  }
}

function refreshTicks() {
  document.querySelectorAll("input[data-list]").forEach((cb) => {
    cb.checked = isChecked(cb.dataset.list, cb.dataset.item);
  });
  updateProgress();
}

function updateProgress() {
  document.querySelectorAll("details[data-list]").forEach((d) => {
    const boxes = d.querySelectorAll("input[data-list]");
    const done = [...boxes].filter((b) => b.checked).length;
    const out = d.querySelector(".progress");
    if (out) out.textContent = boxes.length ? ` (${done}/${boxes.length})` : "";
  });
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
  await loadExtras();
  drawExtras();
}

/* ---------- Supabase ---------- */

let channel = null;
let extrasChannel = null;

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
  if (!state.user) return;
  channel = state.supabase
    .channel("meal_checks_live")
    .on("postgres_changes", { event: "*", schema: "public", table: "meal_checks" }, (payload) => {
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      if (!row || !row.list_key) return;
      state.checks[tickKey(row.list_key, row.item_key)] =
        payload.eventType === "DELETE" ? false : !!row.checked;
      refreshTicks();
    })
    .subscribe();
  // Separate channel so a missing extras table can never break tick sync.
  if (state.extrasReady) {
    extrasChannel = state.supabase
      .channel("extras_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_extras" }, async () => {
        await loadExtras();
        drawExtras();
      })
      .subscribe();
  }
}

async function loadSharedData() {
  await Promise.all([loadRemoteChecks(), loadRoster(), loadExtras()]);
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

function dayCard(day) {
  return h(
    "article",
    { class: "card" },
    h("h3", null, fmtDate(day.date), " ", shiftChip(day.date)),
    day.breakfast ? h("p", null, h("span", { class: "label" }, "Baby breakfast"), recipeLink(day.breakfast)) : null,
    day.dinner ? h("p", null, h("span", { class: "label" }, "Dinner"), recipeLink(day.dinner)) : null,
    chips(dayAllergens(day)),
    day.note ? h("p", { class: "note" }, day.note) : null
  );
}

/* ---------- views ---------- */

function viewToday() {
  if (!state.plan.length) return h("p", { class: "muted" }, "No plan loaded yet.");
  const today = localISO();
  let day = state.plan.find((d) => d.date === today);
  let heading = "Today";
  if (!day) {
    day = state.plan.find((d) => d.date > today);
    heading = "Next up";
    if (!day) {
      day = state.plan[state.plan.length - 1];
      heading = "Latest planned day";
    }
  }
  return h(
    "section",
    null,
    h("h2", null, heading),
    dayCard(day),
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
            shiftChip(iso)
          ),
          p && p.dinner
            ? h("div", { class: "cal-meal" }, h("span", { class: "label" }, "Dinner"), recipeLink(p.dinner, true))
            : null,
          p && p.breakfast
            ? h("div", { class: "cal-meal" }, h("span", { class: "label" }, "Baby"), recipeLink(p.breakfast, true))
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

function tickItem(listId, item, extra) {
  const id = `t-${listId}-${item.id}`;
  const cb = h("input", {
    type: "checkbox",
    id,
    "data-list": listId,
    "data-item": item.id,
    checked: isChecked(listId, item.id),
    onchange: (e) => {
      setChecked(listId, item.id, e.target.checked);
      updateProgress();
    },
  });
  return h("li", null, cb, h("label", { for: id }, item.text), extra || null);
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
  const items = state.extras.length
    ? h(
        "ul",
        { class: "ticks" },
        state.extras.map((x) =>
          tickItem(
            "extras",
            { id: x.id, text: x.item },
            h(
              "button",
              {
                type: "button",
                class: "secondary small",
                "aria-label": "Remove " + x.item,
                onclick: () => removeExtra(x.id),
              },
              "Remove"
            )
          )
        )
      )
    : h("p", { class: "muted" }, "Nothing here yet.");
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
  return [items, form, clear];
}

function drawExtras() {
  const box = document.getElementById("extras-box");
  if (!box) return;
  box.replaceChildren(...extrasContent().filter(Boolean));
  refreshTicks();
}

function viewShopping() {
  const note = state.supabase
    ? state.user
      ? "Ticks sync live between your phones."
      : "Log in so ticks sync between your phones. Until then they save on this device only."
    : "Ticks save on this device only.";
  return h(
    "section",
    null,
    h("h2", null, "Shopping"),
    h("p", { class: "muted" }, note),
    state.shopping.map((list, idx) =>
      h(
        "details",
        { class: "list card", "data-list": list.id, open: idx === 0 },
        h("summary", null, `${list.title}: ${list.buy}`, h("span", { class: "progress" })),
        h("p", { class: "note" }, `Covers ${list.covers}. ${list.estimate}`),
        list.groups.map((g) =>
          h(
            "div",
            null,
            h("div", { class: "store" }, g.store),
            h("ul", { class: "ticks" }, g.items.map((it) => tickItem(list.id, it)))
          )
        ),
        h(
          "button",
          {
            type: "button",
            class: "secondary",
            onclick: async () => {
              if (!window.confirm("Clear all ticks on " + list.title + "?")) return;
              for (const g of list.groups)
                for (const it of g.items) {
                  if (isChecked(list.id, it.id)) await setChecked(list.id, it.id, false);
                }
              refreshTicks();
            },
          },
          "Clear ticks"
        )
      )
    ),
    h(
      "details",
      { class: "list card", "data-list": "extras", open: true },
      h("summary", null, "Household extras", h("span", { class: "progress" })),
      h("p", { class: "note" }, "Cleaning supplies, toiletries and anything else that isn't for the meals."),
      h("div", { id: "extras-box" }, extrasContent().filter(Boolean))
    )
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
      h("p", null, "You're logged in. Ticks, extras, notes and shifts sync live."),
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
  try {
    const [recipes, plan, shopping] = await Promise.all([
      loadJSON("data/recipes.json"),
      loadJSON("data/plan.json"),
      loadJSON("data/shopping.json"),
    ]);
    state.recipes = recipes;
    state.byId = Object.fromEntries(recipes.map((r) => [r.id, r]));
    state.plan = plan.days;
    planNote = plan.note || "";
    state.shopping = shopping;
  } catch (e) {
    app.replaceChildren(h("p", { class: "error" }, "Couldn't load the meal data. Try refreshing."));
    return;
  }
  loadLocalChecks();
  await initSupabase();
  await loadSharedData();
  startRealtime();
  updateNav();
  window.addEventListener("hashchange", () => route(true));
  route(false);
}

init();
