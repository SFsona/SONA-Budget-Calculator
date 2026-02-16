/* SONA Budget Calculator v1
   Data driven via data.json
   Prices stored ex VAT
*/

const state = {
  data: null,
  step: 1,
  rooms: [],
  activeRoomIndex: 0,
  includeVat: false
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

  byId("backBtn").classList.toggle("hidden", step === 1);

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
    choice: {}
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

function getRoomBaseTotalExVat(room) {
  let total = 0;

  for (const [optionId, qty] of Object.entries(room.qty)) {
    const opt = optionById(optionId);
    if (!opt) continue;
    total += opt.price * Number(qty || 0);
  }

  for (const optionId of Object.values(room.choice)) {
    const opt = optionById(optionId);
    if (!opt) continue;
    total += opt.price;
  }

  return total;
}

function getRoomTags(room) {
  const tags = [];

  for (const [optionId, qty] of Object.entries(room.qty)) {
    const opt = optionById(optionId);
    if (!opt) continue;
    const count = Math.max(0, Number(qty || 0));
    for (let i = 0; i < count; i++) tags.push(...(opt.tags || []));
  }

  for (const optionId of Object.values(room.choice)) {
    const opt = optionById(optionId);
    if (!opt) continue;
    tags.push(...(opt.tags || []));
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

  const baseTotalExVat = state.rooms.reduce((sum, r) => sum + getRoomBaseTotalExVat(r), 0);
  const addOnTotalExVat = addOns.reduce((sum, a) => sum + a.amountExVat, 0);

  const subTotalExVat = baseTotalExVat + addOnTotalExVat;
  const vatAmount = subTotalExVat * vatRate();
  const totalIncVat = subTotalExVat + vatAmount;

  return { addOns, baseTotalExVat, addOnTotalExVat, subTotalExVat, vatAmount, totalIncVat };
}

function updateTotalsUI() {
  const totals = computeTotals();
  const activeRoom = state.rooms[state.activeRoomIndex];

  const overall = state.includeVat ? totals.totalIncVat : totals.subTotalExVat;
  byId("overallTotal").textContent = money(overall);

  if (activeRoom) {
    byId("roomTotal").textContent = money(applyVat(getRoomBaseTotalExVat(activeRoom)));
  } else {
    byId("roomTotal").textContent = money(0);
  }

  setVatModeUI();
}

function renderActiveRoom() {
  const room = state.rooms[state.activeRoomIndex];
  if (!room) return;

  byId("activeRoomTitle").textContent = room.name;
  byId("activeRoomMeta").textContent = room.type;

  const wrap = byId("optionsWrap");
  wrap.innerHTML = "";

  for (const cat of state.data.categories) {
    const opts = optionsByCategory(cat.id);
    if (!opts.length) continue;

    const section = document.createElement("div");
    section.className = "category";

    const h = document.createElement("h2");
    h.className = "categoryTitle";
    h.textContent = cat.label;
    section.appendChild(h);

    for (const opt of opts) {
      section.appendChild(renderOptionRow(room, opt));
    }

    wrap.appendChild(section);
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
    right.textContent = money(applyVat(getRoomBaseTotalExVat(room)));

    head.appendChild(left);
    head.appendChild(right);
    block.appendChild(head);

    const list = document.createElement("div");
    list.className = "summaryList";

    for (const [optionId, qty] of Object.entries(room.qty)) {
      const opt = optionById(optionId);
      if (!opt) continue;

      const line = document.createElement("div");
      line.className = "summaryLine";
      line.innerHTML = `<div>${opt.label} × ${qty}</div><div>${money(applyVat(opt.price * qty))}</div>`;
      list.appendChild(line);
    }

    for (const optionId of Object.values(room.choice)) {
      const opt = optionById(optionId);
      if (!opt) continue;

      const line = document.createElement("div");
      line.className = "summaryLine";
      line.innerHTML = `<div>${opt.label}</div><div>${money(applyVat(opt.price))}</div>`;
      list.appendChild(line);
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

  const sub = document.createElement("div");
  sub.className = "summaryLine";
  sub.innerHTML = `<div>Subtotal (ex VAT)</div><div>${money(totals.subTotalExVat)}</div>`;
  totalsWrap.appendChild(sub);

  const vatLine = document.createElement("div");
  vatLine.className = "summaryLine";
  vatLine.innerHTML = `<div>VAT (${Math.round(vatRate() * 100)}%)</div><div>${money(totals.vatAmount)}</div>`;
  totalsWrap.appendChild(vatLine);

  const totalLine = document.createElement("div");
  totalLine.className = "summaryLine";
  const totalDisplay = state.includeVat ? totals.totalIncVat : totals.subTotalExVat;
  totalLine.innerHTML = `<div>Total (${state.includeVat ? "inc VAT" : "ex VAT"})</div><div>${money(totalDisplay)}</div>`;
  totalsWrap.appendChild(totalLine);

  updateTotalsUI();
}


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
  setVatModeUI();
  showStep(1);
}

main().catch(err => {
  console.error(err);
  document.body.innerHTML =
    `<div style="padding:20px;font-family:system-ui;color:white;">Error loading calculator. Open the browser console for details.</div>`;
});
