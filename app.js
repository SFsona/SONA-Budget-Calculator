/* SONA Budget Calculator v1
   Data driven via data.json
   Prices stored ex VAT

   Range families support
   Certain option groups can be entered as a single qty and displayed as a low to high range.
   Requires data.json to include:
     - rangeFamilies: [{ id, label, categoryId, sourceOptionIds, tagsPerFamily?, tagsPerUnit? }, ...]

   Includes a UI switch to toggle between:
     - Range mode (single qty + range) for rangeFamilies
     - Detailed mode (individual tier options)
*/

const state = {
  data: null,
  step: 1,
  rooms: [],
  activeRoomIndex: 0,
  includeVat: false,
  useRanges: true
};

function byId(id) {
  return document.getElementById(id);
}

function currencySymbol() {
  return state.data?.currencySymbol || "£";
}

function vatRate() {
  return Number(state.data?.vatRate ?? 0.2);
}

function money(value) {
  const s = currencySymbol();
  const n = Math.round((value + Number.EPSILON) * 100) / 100;
  return `${s}${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function applyVat(amountExVat) {
  return state.includeVat ? amountExVat * (1 + vatRate()) : amountExVat;
}

function moneyRangeDisplay(low, high) {
  const a = money(low);
  const b = money(high);
  return low === high ? a : `${a} to ${b}`;
}

function setVatModeUI() {
  byId("vatMode").textContent = state.includeVat ? "Inc VAT" : "Ex VAT";
}

function setPills() {
  const p1 = byId("pill1");
  const p2 = byId("pill2");
  const p3 = byId("pill3");

  [p1, p2, p3].forEach(p => p.classList.remove("pillActive"));
  if (state.step === 1) p1.classList.add("pillActive");
  if (state.step === 2) p2.classList.add("pillActive");
  if (state.step === 3) p3.classList.add("pillActive");
}

function showStep(step) {
  state.step = step;

  byId("step1").classList.toggle("hidden", step !== 1);
  byId("step2").classList.toggle("hidden", step !== 2);
  byId("step3").classList.toggle("hidden", step !== 3);

  byId("backBtn").classList.toggle("invisible", step === 1);
  byId("backBtn").classList.remove("hidden");




  setPills();

  if (step === 1) renderRoomsList();
  if (step === 2) renderActiveRoom();
  if (step === 3) renderSummary();

  updateTotalsUI();
}

function initRoomTypeSelect() {
  const sel = byId("roomType");
  sel.innerHTML = "";
  for (const t of state.data.roomTypes) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    sel.appendChild(opt);
  }
}

function newRoom(name, type) {
  return {
    id: crypto.randomUUID(),
    name,
    type,
    qty: {},
    choice: {},
    rangeQty: {}
  };
}

function addRoom() {
  const nameInput = byId("roomName");
  const typeSel = byId("roomType");

  const name = (nameInput.value || "").trim();
  if (!name) return;

  state.rooms.push(newRoom(name, typeSel.value));
  nameInput.value = "";

  renderRoomsList();
  updateTotalsUI();
}

function removeRoom(roomId) {
  state.rooms = state.rooms.filter(r => r.id !== roomId);
  state.activeRoomIndex = Math.min(state.activeRoomIndex, Math.max(0, state.rooms.length - 1));
  renderRoomsList();
  updateTotalsUI();
}

function renderRoomsList() {
  const list = byId("roomsList");
  list.innerHTML = "";

  for (const room of state.rooms) {
    const card = document.createElement("div");
    card.className = "roomCard";

    const left = document.createElement("div");
    left.className = "roomCardLeft";

    const title = document.createElement("div");
    title.className = "roomCardTitle";
    title.textContent = room.name;

    const meta = document.createElement("div");
    meta.className = "roomCardMeta";
    meta.textContent = room.type;

    left.appendChild(title);
    left.appendChild(meta);

    const actions = document.createElement("div");
    const del = document.createElement("button");
    del.className = "btn btnGhost";
    del.type = "button";
    del.textContent = "Remove";
    del.addEventListener("click", () => removeRoom(room.id));
    actions.appendChild(del);

    card.appendChild(left);
    card.appendChild(actions);

    list.appendChild(card);
  }

  byId("startBtn").disabled = state.rooms.length === 0;
}

function optionById(id) {
  return state.data.options.find(o => o.id === id) || null;
}

function optionsByCategory(categoryId) {
  return state.data.options.filter(o => o.categoryId === categoryId);
}

/* Range families helpers */

function rangeFamilies() {
  return state.data?.rangeFamilies || [];
}

function rangeFamiliesByCategory(categoryId) {
  return rangeFamilies().filter(f => f.categoryId === categoryId);
}

function rangeFamilyMinMaxPriceExVat(family) {
  const prices = (family.sourceOptionIds || [])
    .map(id => optionById(id))
    .filter(Boolean)
    .map(o => Number(o.price || 0));

  if (!prices.length) return { min: 0, max: 0 };

  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function optionIsHiddenByRangeFamilies(opt) {
  for (const fam of rangeFamilies()) {
    if ((fam.sourceOptionIds || []).includes(opt.id)) return true;
  }
  return false;
}

/* Totals */

function computeRoomOptionAddonExVat(opt, qty) {
  if (!opt || !opt.roomAddon) return 0;

  const every = Number(opt.roomAddon.every || 0);
  const amount = Number(opt.roomAddon.amount || 0);
  const q = Number(qty || 0);

  if (every <= 0 || amount <= 0 || q <= 0) return 0;

  return Math.ceil(q / every) * amount;
}

function getRoomBaseTotalsExVat(room) {
  let low = 0;
  let high = 0;

  // Fixed qty options
  for (const [optionId, qty] of Object.entries(room.qty)) {
    const opt = optionById(optionId);
    if (!opt) continue;

    const q = Number(qty || 0);
    const line = opt.price * q;
    const addon = computeRoomOptionAddonExVat(opt, q);

    low += line + addon;
    high += line + addon;
  }

  // Fixed choice options
  for (const optionId of Object.values(room.choice)) {
    const opt = optionById(optionId);
    if (!opt) continue;

    low += opt.price;
    high += opt.price;
  }

  // Range families only when enabled
  if (state.useRanges) {
    for (const fam of rangeFamilies()) {
      const q = Math.max(0, Number(room.rangeQty?.[fam.id] || 0));
      if (!q) continue;

      const mm = rangeFamilyMinMaxPriceExVat(fam);
      low += mm.min * q;
      high += mm.max * q;
    }
  }

  return { low, high };
}

function getRoomBaseTotalExVat(room) {
  return getRoomBaseTotalsExVat(room).high;
}

/* Tags and rules */

function getRoomTags(room) {
  const tags = [];

  // Existing qty options: tags per unit
  for (const [optionId, qty] of Object.entries(room.qty)) {
    const opt = optionById(optionId);
    if (!opt) continue;
    const count = Math.max(0, Number(qty || 0));
    for (let i = 0; i < count; i++) tags.push(...(opt.tags || []));
  }

  // Existing choice options: tags once
  for (const optionId of Object.values(room.choice)) {
    const opt = optionById(optionId);
    if (!opt) continue;
    tags.push(...(opt.tags || []));
  }

  // Range families only when enabled
  if (state.useRanges) {
    for (const fam of rangeFamilies()) {
      const q = Math.max(0, Number(room.rangeQty?.[fam.id] || 0));
      if (!q) continue;

      tags.push(...(fam.tagsPerFamily || []));

      for (let i = 0; i < q; i++) {
        tags.push(...(fam.tagsPerUnit || []));
      }
    }
  }

  return tags;
}

function tallyTagsAllRooms() {
  const tally = new Map();
  for (const room of state.rooms) {
    for (const tag of getRoomTags(room)) {
      tally.set(tag, (tally.get(tag) || 0) + 1);
    }
  }
  return tally;
}

function roomHasAnyTags(room, tagList) {
  const tags = new Set(getRoomTags(room));
  return (tagList || []).some(t => tags.has(t));
}

function projectHasAnyTags(tagList) {
  const tally = tallyTagsAllRooms();
  return (tagList || []).some(t => (tally.get(t) || 0) > 0);
}

function computeRuleAddOnsExVat() {
  const rules = state.data.rules || {};
  const addOns = [];

  if (rules.networkAllowance) {
    const r = rules.networkAllowance;
    let countRooms = 0;
    for (const room of state.rooms) {
      if (roomHasAnyTags(room, r.appliesIfRoomHasAnyTags)) countRooms += 1;
    }
    if (countRooms > 0) {
      addOns.push({
        id: "networkAllowance",
        label: r.label,
        amountExVat: (r.amountPerRoom || 0) * countRooms,
        detail: `${countRooms} room${countRooms === 1 ? "" : "s"}`
      });
    }
  }

  if (rules.rackAllowance) {
    const r = rules.rackAllowance;
    if (projectHasAnyTags(r.appliesIfProjectHasAnyTags)) {
      const tally = tallyTagsAllRooms();
      const unitTag = r.rackUnitTag || "rack_unit";
      const units = tally.get(unitTag) || 0;

      addOns.push({
        id: "rackAllowance",
        label: r.label,
        amountExVat: (r.baseAmount || 0) + (r.amountPerRackUnitTag || 0) * units,
        detail: `${units} rack unit${units === 1 ? "" : "s"}`
      });
    }
  }

  return addOns;
}

function computeTotals() {
  const addOns = computeRuleAddOnsExVat();

  const roomTotals = state.rooms.map(r => getRoomBaseTotalsExVat(r));

  const baseLow = roomTotals.reduce((sum, t) => sum + t.low, 0);
  const baseHigh = roomTotals.reduce((sum, t) => sum + t.high, 0);

  const addOnTotalExVat = addOns.reduce((sum, a) => sum + a.amountExVat, 0);

  const subLow = baseLow + addOnTotalExVat;
  const subHigh = baseHigh + addOnTotalExVat;

  const vatLow = subLow * vatRate();
  const vatHigh = subHigh * vatRate();

  const totalIncLow = subLow + vatLow;
  const totalIncHigh = subHigh + vatHigh;

  return {
    addOns,
    baseTotalExVatLow: baseLow,
    baseTotalExVatHigh: baseHigh,
    addOnTotalExVat,
    subTotalExVatLow: subLow,
    subTotalExVatHigh: subHigh,
    vatAmountLow: vatLow,
    vatAmountHigh: vatHigh,
    totalIncVatLow: totalIncLow,
    totalIncVatHigh: totalIncHigh
  };
}

function updateTotalsUI() {
  const totals = computeTotals();
  const activeRoom = state.rooms[state.activeRoomIndex];

  const overallLow = state.includeVat ? totals.totalIncVatLow : totals.subTotalExVatLow;
  const overallHigh = state.includeVat ? totals.totalIncVatHigh : totals.subTotalExVatHigh;
  byId("overallTotal").textContent = moneyRangeDisplay(overallLow, overallHigh);

  if (activeRoom) {
    const rt = getRoomBaseTotalsExVat(activeRoom);
    const roomLow = applyVat(rt.low);
    const roomHigh = applyVat(rt.high);
    byId("roomTotal").textContent = moneyRangeDisplay(roomLow, roomHigh);
  } else {
    byId("roomTotal").textContent = money(0);
  }

  setVatModeUI();
}

/* Options UI */

function renderActiveRoom() {
  const room = state.rooms[state.activeRoomIndex];
  if (!room) return;

  byId("activeRoomTitle").textContent = room.name;
  byId("activeRoomMeta").textContent = room.type;

  const wrap = byId("optionsWrap");
  wrap.innerHTML = "";

  for (const cat of state.data.categories) {
    const fams = rangeFamiliesByCategory(cat.id);

    const opts = optionsByCategory(cat.id).filter(o => {
      if (!state.useRanges) return true;
      return !optionIsHiddenByRangeFamilies(o);
    });

    if ((!state.useRanges || !fams.length) && !opts.length) continue;
    if (state.useRanges && !fams.length && !opts.length) continue;

    const section = document.createElement("div");
    section.className = "category";

    const h = document.createElement("h2");
    h.className = "categoryTitle";
    h.textContent = cat.label;
    section.appendChild(h);

    if (state.useRanges) {
      for (const fam of fams) {
        section.appendChild(renderRangeFamilyRow(room, fam));
      }
    }

    for (const opt of opts) {
      section.appendChild(renderOptionRow(room, opt));
    }

    if (section.children.length > 1) {
      wrap.appendChild(section);
    }
  }

  updateTotalsUI();
}

function renderOptionRow(room, opt) {
  const row = document.createElement("div");
  row.className = "optionRow";

  const main = document.createElement("div");
  main.className = "optionMain";

  const label = document.createElement("div");
  label.className = "optionLabel";
  label.textContent = opt.label;

  const price = document.createElement("div");
  price.className = "optionPrice";
  price.textContent = `${money(applyVat(opt.price))}${opt.inputType === "qty" ? " each" : ""}`;

  main.appendChild(label);
  main.appendChild(price);

  const control = document.createElement("div");

  if (opt.inputType === "qty") {
    const qtyWrap = document.createElement("div");
    qtyWrap.className = "qty";

    const minus = document.createElement("button");
    minus.className = "qtyBtn";
    minus.type = "button";
    minus.textContent = "–";

    const val = document.createElement("div");
    val.className = "qtyValue";
    val.textContent = String(Number(room.qty[opt.id] || 0));

    const plus = document.createElement("button");
    plus.className = "qtyBtn";
    plus.type = "button";
    plus.textContent = "+";

    minus.addEventListener("click", () => {
      const next = Math.max(0, Number(room.qty[opt.id] || 0) - 1);
      if (next === 0) delete room.qty[opt.id];
      else room.qty[opt.id] = next;
      val.textContent = String(next);
      updateTotalsUI();
    });

    plus.addEventListener("click", () => {
      const next = Math.max(0, Number(room.qty[opt.id] || 0) + 1);
      room.qty[opt.id] = next;
      val.textContent = String(next);
      updateTotalsUI();
    });

    qtyWrap.appendChild(minus);
    qtyWrap.appendChild(val);
    qtyWrap.appendChild(plus);
    control.appendChild(qtyWrap);
  }

  if (opt.inputType === "choice") {
    const choiceWrap = document.createElement("label");
    choiceWrap.className = "choice";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = `room_${room.id}_group_${opt.groupId}`;
    input.checked = room.choice[opt.groupId] === opt.id;

    input.addEventListener("change", () => {
      room.choice[opt.groupId] = opt.id;
      updateTotalsUI();
    });

    const text = document.createElement("div");
    text.textContent = "Select";

    choiceWrap.appendChild(input);
    choiceWrap.appendChild(text);
    control.appendChild(choiceWrap);
  }

  row.appendChild(main);
  row.appendChild(control);

  return row;
}

function renderRangeFamilyRow(room, fam) {
  const row = document.createElement("div");
  row.className = "optionRow";

  const main = document.createElement("div");
  main.className = "optionMain";

  const label = document.createElement("div");
  label.className = "optionLabel";
  label.textContent = fam.label;

  const mm = rangeFamilyMinMaxPriceExVat(fam);
  const price = document.createElement("div");
  price.className = "optionPrice";

  const minEach = applyVat(mm.min);
  const maxEach = applyVat(mm.max);
  price.textContent = `${money(minEach)} to ${money(maxEach)} each`;

  main.appendChild(label);
  main.appendChild(price);

  const control = document.createElement("div");
  const qtyWrap = document.createElement("div");
  qtyWrap.className = "qty";

  const minus = document.createElement("button");
  minus.className = "qtyBtn";
  minus.type = "button";
  minus.textContent = "–";

  const val = document.createElement("div");
  val.className = "qtyValue";
  val.textContent = String(Math.max(0, Number(room.rangeQty?.[fam.id] || 0)));

  const plus = document.createElement("button");
  plus.className = "qtyBtn";
  plus.type = "button";
  plus.textContent = "+";

  minus.addEventListener("click", () => {
    const next = Math.max(0, Number(room.rangeQty?.[fam.id] || 0) - 1);
    if (next === 0) delete room.rangeQty[fam.id];
    else room.rangeQty[fam.id] = next;
    val.textContent = String(next);
    updateTotalsUI();
  });

  plus.addEventListener("click", () => {
    const next = Math.max(0, Number(room.rangeQty?.[fam.id] || 0) + 1);
    room.rangeQty[fam.id] = next;
    val.textContent = String(next);
    updateTotalsUI();
  });

  qtyWrap.appendChild(minus);
  qtyWrap.appendChild(val);
  qtyWrap.appendChild(plus);

  control.appendChild(qtyWrap);

  row.appendChild(main);
  row.appendChild(control);

  return row;
}

/* Summary */

function renderSummary() {
  const roomsWrap = byId("summaryRooms");
  const rulesWrap = byId("summaryRules");
  const totalsWrap = byId("summaryTotals");

  roomsWrap.innerHTML = "";
  rulesWrap.innerHTML = "";
  totalsWrap.innerHTML = "";

  const totals = computeTotals();

  for (const room of state.rooms) {
    const block = document.createElement("div");
    block.className = "summaryBlock";

    const head = document.createElement("div");
    head.className = "summaryRoomTitle";

    const left = document.createElement("div");
    left.innerHTML =
      `<div class="subtitle">${room.name}</div>` +
      `<div class="summaryLine summaryLineMuted">${room.type}</div>`;

    const right = document.createElement("div");
    right.style.fontSize = "14px";
    const rt = getRoomBaseTotalsExVat(room);
    right.textContent = moneyRangeDisplay(applyVat(rt.low), applyVat(rt.high));

    head.appendChild(left);
    head.appendChild(right);
    block.appendChild(head);

    const list = document.createElement("div");
    list.className = "summaryList";

    // Fixed qty selections
    for (const [optionId, qty] of Object.entries(room.qty)) {
      const opt = optionById(optionId);
      if (!opt) continue;

      const q = Number(qty || 0);

      const line = document.createElement("div");
      line.className = "summaryLine";
      line.innerHTML = `<div>${opt.label} × ${q}</div><div>${money(applyVat(opt.price * q))}</div>`;
      list.appendChild(line);

      const addon = computeRoomOptionAddonExVat(opt, q);
      if (addon > 0) {
        const blocks = Math.ceil(q / Number(opt.roomAddon.every));
        const addonLine = document.createElement("div");
        addonLine.className = "summaryLine summaryLineMuted";
        addonLine.innerHTML =
          `<div>Driver allowance for ${opt.label} (${blocks} × ${money(applyVat(Number(opt.roomAddon.amount)))})</div>` +
          `<div>${money(applyVat(addon))}</div>`;
        list.appendChild(addonLine);
      }
    }

    // Fixed choice selections
    for (const optionId of Object.values(room.choice)) {
      const opt = optionById(optionId);
      if (!opt) continue;

      const line = document.createElement("div");
      line.className = "summaryLine";
      line.innerHTML = `<div>${opt.label}</div><div>${money(applyVat(opt.price))}</div>`;
      list.appendChild(line);
    }

    // Range family selections only when enabled
    if (state.useRanges) {
      for (const fam of rangeFamilies()) {
        const q = Math.max(0, Number(room.rangeQty?.[fam.id] || 0));
        if (!q) continue;

        const mm = rangeFamilyMinMaxPriceExVat(fam);
        const low = applyVat(mm.min * q);
        const high = applyVat(mm.max * q);

        const line = document.createElement("div");
        line.className = "summaryLine";
        line.innerHTML = `<div>${fam.label} × ${q}</div><div>${moneyRangeDisplay(low, high)}</div>`;
        list.appendChild(line);
      }
    }

    if (!list.children.length) {
      const empty = document.createElement("div");
      empty.className = "summaryLine summaryLineMuted";
      empty.textContent = "No selections";
      list.appendChild(empty);
    }

    block.appendChild(list);
    roomsWrap.appendChild(block);
  }

  // Project add ons
  if (totals.addOns.length) {
    for (const a of totals.addOns) {
      const line = document.createElement("div");
      line.className = "summaryLine";
      const detail = a.detail ? ` <span class="summaryLineMuted">(${a.detail})</span>` : "";
      line.innerHTML = `<div>${a.label}${detail}</div><div>${money(applyVat(a.amountExVat))}</div>`;
      rulesWrap.appendChild(line);
    }
  } else {
    const empty = document.createElement("div");
    empty.className = "summaryLine summaryLineMuted";
    empty.textContent = "No add ons applied";
    rulesWrap.appendChild(empty);
  }

  // Totals (range aware)
  const sub = document.createElement("div");
  sub.className = "summaryLine";
  sub.innerHTML = `<div>Subtotal (ex VAT)</div><div>${moneyRangeDisplay(totals.subTotalExVatLow, totals.subTotalExVatHigh)}</div>`;
  totalsWrap.appendChild(sub);

  const vatLine = document.createElement("div");
  vatLine.className = "summaryLine";
  vatLine.innerHTML = `<div>VAT (${Math.round(vatRate() * 100)}%)</div><div>${moneyRangeDisplay(totals.vatAmountLow, totals.vatAmountHigh)}</div>`;
  totalsWrap.appendChild(vatLine);

  const totalLine = document.createElement("div");
  totalLine.className = "summaryLine";

  if (state.includeVat) {
    totalLine.innerHTML = `<div>Total (inc VAT)</div><div>${moneyRangeDisplay(totals.totalIncVatLow, totals.totalIncVatHigh)}</div>`;
  } else {
    totalLine.innerHTML = `<div>Total (ex VAT)</div><div>${moneyRangeDisplay(totals.subTotalExVatLow, totals.subTotalExVatHigh)}</div>`;
  }

  totalsWrap.appendChild(totalLine);

  updateTotalsUI();
}

/* Events and boot */

function wireEvents() {
  byId("addRoomBtn").addEventListener("click", addRoom);

  byId("roomName").addEventListener("keydown", e => {
    if (e.key === "Enter") addRoom();
  });

  byId("startBtn").addEventListener("click", () => {
    state.activeRoomIndex = 0;
    showStep(2);
  });

  byId("backBtn").addEventListener("click", () => {
    if (state.step === 2) showStep(1);
    else if (state.step === 3) showStep(2);
  });

  byId("prevRoomBtn").addEventListener("click", () => {
    state.activeRoomIndex = Math.max(0, state.activeRoomIndex - 1);
    renderActiveRoom();
  });

  byId("nextRoomBtn").addEventListener("click", () => {
    state.activeRoomIndex = Math.min(state.rooms.length - 1, state.activeRoomIndex + 1);
    renderActiveRoom();
  });

  byId("reviewBtn").addEventListener("click", () => showStep(3));
  byId("editBtn").addEventListener("click", () => showStep(2));
  byId("printBtn").addEventListener("click", () => window.print());

  byId("vatToggle").addEventListener("change", e => {
    state.includeVat = Boolean(e.target.checked);
    if (state.step === 2) renderActiveRoom();
    if (state.step === 3) renderSummary();
    updateTotalsUI();
  });

  const rangeToggle = byId("rangeToggle");
  if (rangeToggle) {
    rangeToggle.addEventListener("change", e => {
      state.useRanges = Boolean(e.target.checked);
      if (state.step === 2) renderActiveRoom();
      if (state.step === 3) renderSummary();
      updateTotalsUI();
    });
  }
}

async function loadData() {
  const res = await fetch("./data.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load data.json");
  state.data = await res.json();
}

async function main() {
  await loadData();
  initRoomTypeSelect();
  wireEvents();

  const rangeToggle = byId("rangeToggle");
  if (rangeToggle) {
    rangeToggle.checked = true;
    state.useRanges = true;
  }

  setVatModeUI();
  showStep(1);
}

main().catch(err => {
  console.error(err);
  document.body.innerHTML =
    `<div style="padding:20px;font-family:system-ui;color:white;">Error loading calculator. Open the browser console for details.</div>`;
});
