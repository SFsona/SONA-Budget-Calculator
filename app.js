/* SONA Budget Calculator v1
   Data driven via data.json
*/

const state = {
  data: null,
  step: 1,
  rooms: [],
  activeRoomIndex: 0,
};

const els = {};

function byId(id) {
  return document.getElementById(id);
}

function money(value) {
  const s = state.data?.currencySymbol || "£";
  const n = Math.round((value + Number.EPSILON) * 100) / 100;
  return `${s}${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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

  const backBtn = byId("backBtn");
  backBtn.classList.toggle("hidden", step === 1);

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
    qty: {},        // optionId -> number
    choice: {},     // groupId -> optionId
  };
}

function addRoom() {
  const nameInput = byId("roomName");
  const typeSel = byId("roomType");

  const name = (nameInput.value || "").trim();
  const type = typeSel.value;

  if (!name) return;

  state.rooms.push(newRoom(name, type));
  nameInput.value = "";

  renderRoomsList();
  updateTotalsUI();
}

function removeRoom(roomId) {
  state.rooms = state.rooms.filter(r => r.id !== roomId);
  if (state.activeRoomIndex >= state.rooms.length) state.activeRoomIndex = Math.max(0, state.rooms.length - 1);
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
    actions.className = "roomCardActions";

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

function optionById(optionId) {
  return state.data.options.find(o => o.id === optionId) || null;
}

function optionsByCategory(categoryId) {
  return state.data.options.filter(o => o.categoryId === categoryId);
}

function getRoomBaseTotal(room) {
  let total = 0;

  for (const [optionId, qty] of Object.entries(room.qty)) {
    const opt = optionById(optionId);
    if (!opt) continue;
    total += opt.price * (qty || 0);
  }

  for (const [groupId, optionId] of Object.entries(room.choice)) {
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
  return tagList.some(t => tags.has(t));
}

function projectHasAnyTags(tagList) {
  const tally = tallyTagsAllRooms();
  return tagList.some(t => (tally.get(t) || 0) > 0);
}

function computeRuleAddOns() {
  const rules = state.data.rules || {};
  const addOns = [];

  // Network allowance per room if room has needs_network
  if (rules.networkAllowance) {
    const r = rules.networkAllowance;
    let countRooms = 0;
    for (const room of state.rooms) {
      if (roomHasAnyTags(room, r.appliesIfRoomHasAnyTags || [])) countRooms += 1;
    }
    if (countRooms > 0) {
      addOns.push({
        id: "networkAllowance",
        label: r.label,
        amount: (r.amountPerRoom || 0) * countRooms,
        detail: `${countRooms} room${countRooms === 1 ? "" : "s"}`
      });
    }
  }

  // Rack allowance once if project has needs_rack, plus per rack_unit count
  if (rules.rackAllowance) {
    const r = rules.rackAllowance;
    const applies = projectHasAnyTags(r.appliesIfProjectHasAnyTags || []);
    if (applies) {
      const tally = tallyTagsAllRooms();
      const unitTag = r.rackUnitTag || "rack_unit";
      const units = tally.get(unitTag) || 0;

      const amount = (r.baseAmount || 0) + (r.amountPerRackUnitTag || 0) * units;

      addOns.push({
        id: "rackAllowance",
        label: r.label,
        amount,
        detail: `${units} rack unit${units === 1 ? "" : "s"}`
      });
    }
  }

  return addOns;
}

function computeTotals() {
  const roomTotals = state.rooms.map(r => ({
    roomId: r.id,
    base: getRoomBaseTotal(r)
  }));

  const addOns = computeRuleAddOns();

  const baseTotal = roomTotals.reduce((a, b) => a + b.base, 0);
  const addOnTotal = addOns.reduce((a, b) => a + b.amount, 0);

  const overall = baseTotal + addOnTotal;

  return { roomTotals, addOns, baseTotal, addOnTotal, overall };
}

function updateTotalsUI() {
  const totals = computeTotals();
  const activeRoom = state.rooms[state.activeRoomIndex];

  byId("overallTotal").textContent = money(totals.overall);

  if (activeRoom) {
    byId("roomTotal").textContent = money(getRoomBaseTotal(activeRoom));
  } else {
    byId("roomTotal").textContent = money(0);
  }
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
    if (opts.length === 0) continue;

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
  price.textContent = `${money(opt.price)}${opt.inputType === "qty" ? " each" : ""}`;

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
    const current = Number(room.qty[opt.id] || 0);
    val.textContent = String(current);

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

  roomsWrap.innerHTML = "";
  rulesWrap.innerHTML = "";

  const totals = computeTotals();

  for (const room of state.rooms) {
    const block = document.createElement("div");
    block.className = "summaryBlock";

    const head = document.createElement("div");
    head.className = "summaryRoomTitle";

    const left = document.createElement("div");
    left.innerHTML = `<div class="subtitle">${room.name}</div><div class="summaryLine summaryLineMuted">${room.type}</div>`;

    const right = document.createElement("div");
    right.style.fontSize = "14px";
    right.textContent = money(getRoomBaseTotal(room));

    head.appendChild(left);
    head.appendChild(right);
    block.appendChild(head);

    const list = document.createElement("div");
    list.className = "summaryList";

    // Qty items
    for (const [optionId, qty] of Object.entries(room.qty)) {
      const opt = optionById(optionId);
      if (!opt) continue;
      const line = document.createElement("div");
      line.className = "summaryLine";
      line.innerHTML = `<div>${opt.label} × ${qty}</div><div>${money(opt.price * qty)}</div>`;
      list.appendChild(line);
    }

    // Choice items
    for (const optionId of Object.values(room.choice)) {
      const opt = optionById(optionId);
      if (!opt) continue;
      const line = document.createElement("div");
      line.className = "summaryLine";
      line.innerHTML = `<div>${opt.label}</div><div>${money(opt.price)}</div>`;
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

  // Rules
  if (totals.addOns.length) {
    for (const a of totals.addOns) {
      const line = document.createElement("div");
      line.className = "summaryLine";
      const detail = a.detail ? ` <span class="summaryLineMuted">(${a.detail})</span>` : "";
      line.innerHTML = `<div>${a.label}${detail}</div><div>${money(a.amount)}</div>`;
      rulesWrap.appendChild(line);
    }
  } else {
    const empty = document.createElement("div");
    empty.className = "summaryLine summaryLineMuted";
    empty.textContent = "No add ons applied";
    rulesWrap.appendChild(empty);
  }

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
  showStep(1);
}

main().catch(err => {
  console.error(err);
  document.body.innerHTML = `<div style="padding:20px;font-family:system-ui;color:white;">Error loading calculator. Check console.</div>`;
});
