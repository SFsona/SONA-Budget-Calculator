/* SONA Budget Calculator
   Data driven via data.json
   Prices stored ex VAT

   Supports
   VAT toggle
   Show ranges toggle for selected families
   Network toggle with project access points
   Per room Lighting control mode: Wireless or Wired
   Project lighting processor add ons based on wireless and wired usage
   Room add ons for grouped wired circuits and other per room add ons
*/

const state = {
  data: null,
  step: 1,
  rooms: [],
  activeRoomIndex: 0,
  includeVat: false,
  useRanges: true,
  includeNetwork: false,
  project: {
    accessPointsQty: 0
  }
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
  const n = Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  return `${s}${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function applyVat(amountExVat) {
  return state.includeVat ? Number(amountExVat || 0) * (1 + vatRate()) : Number(amountExVat || 0);
}

function moneyRangeDisplay(low, high) {
  const a = money(low);
  const b = money(high);
  return Number(low) === Number(high) ? a : `${a} to ${b}`;
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

  const back = byId("backBtn");
  back.classList.toggle("invisible", step === 1);
  back.classList.remove("hidden");

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
    rangeQty: {},
    lightingMode: "wireless"
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

function computeRoomOptionAddonExVat(opt, qty) {
  if (!opt || !opt.roomAddon) return 0;

  const every = Number(opt.roomAddon.every || 0);
  const amount = Number(opt.roomAddon.amount || 0);
  const q = Number(qty || 0);

  if (every <= 0 || amount <= 0 || q <= 0) return 0;

  return Math.ceil(q / every) * amount;
}

function resolveDynamicUnitPriceExVat(room, opt) {
  if (!opt) return 0;

  if ((opt.tags || []).includes("motion_sensor")) {
    const type = roomWiredMotionType(room);
    if (type === "head") return Number(state.data?.motionSensors?.head || 0);
    if (type === "local") return Number(state.data?.motionSensors?.local || 0);
    return Number(state.data?.motionSensors?.local || 0);
  }

  return Number(opt.price || 0);
}

function getRoomBaseTotalsExVat(room) {
  let low = 0;
  let high = 0;

  for (const [optionId, qty] of Object.entries(room.qty)) {
    const opt = optionById(optionId);
    if (!opt) continue;

    const q = Number(qty || 0);
    const unitEx = resolveDynamicUnitPriceExVat(room, opt);
    const line = unitEx * q;
    const addon = computeRoomOptionAddonExVat(opt, q);

    low += line + addon;
    high += line + addon;
  }

  for (const optionId of Object.values(room.choice)) {
    const opt = optionById(optionId);
    if (!opt) continue;

    const unitEx = resolveDynamicUnitPriceExVat(room, opt);
    low += unitEx;
    high += unitEx;
  }

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

  if (state.useRanges) {
    for (const fam of rangeFamilies()) {
      const q = Math.max(0, Number(room.rangeQty?.[fam.id] || 0));
      if (!q) continue;

      tags.push(...(fam.tagsPerFamily || []));
      for (let i = 0; i < q; i++) tags.push(...(fam.tagsPerUnit || []));
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

function roomWiredMotionType(room) {
  const tags = new Set(getRoomTags(room));
  if (tags.has("motion_head")) return "head";
  if (tags.has("motion_local")) return "local";
  return null;
}

function computeLightingProcessorMode() {
  const tally = tallyTagsAllRooms();
  const wirelessUsed = (tally.get("keypad_wireless") || 0) > 0;
  const wiredUsed = (tally.get("keypad_wired") || 0) > 0;
  return { wirelessUsed, wiredUsed };
}

function computeLightingProcessorAddOnsExVat() {
  const p = state.data?.lightingProcessors || null;
  if (!p) return [];

  const mode = computeLightingProcessorMode();
  const addOns = [];

  if (!mode.wirelessUsed && !mode.wiredUsed) return addOns;

  if (mode.wiredUsed) {
    addOns.push({
      id: "wiredLightingProcessor",
      label: "Wired lighting control processor",
      amountExVat: Number(p.wiredCost || 0),
      detail: ""
    });
  }

  if (mode.wirelessUsed) {
    const wirelessCost = mode.wiredUsed
      ? Number(p.wirelessWithWiredCost || 0)
      : Number(p.wirelessCost || 0);

    addOns.push({
      id: "wirelessLightingProcessor",
      label: "Wireless lighting control processor",
      amountExVat: wirelessCost,
      detail: mode.wiredUsed ? "With wired processor" : ""
    });
  }

  return addOns;
}

function computeRoomPorts(room) {
  let ports = 0;

  for (const [optionId, qty] of Object.entries(room.qty)) {
    const opt = optionById(optionId);
    if (!opt) continue;
    if (isOptionExcludedFromPorts(opt)) continue;

    const q = Math.max(0, Number(qty || 0));
    const per = Math.max(0, Number(opt.networkPortsPerUnit || 0));
    ports += per * q;
  }

  for (const optionId of Object.values(room.choice)) {
    const opt = optionById(optionId);
    if (!opt) continue;
    if (isOptionExcludedFromPorts(opt)) continue;

    const per = Math.max(0, Number(opt.networkPortsPerUnit || 0));
    ports += per;
  }

  if (state.useRanges) {
    for (const fam of rangeFamilies()) {
      const q = Math.max(0, Number(room.rangeQty?.[fam.id] || 0));
      if (!q) continue;

      const per = Math.max(0, Number(fam.networkPortsPerUnit || 0));
      ports += per * q;
    }
  }

  return ports;
}

function isOptionExcludedFromPorts(opt) {
  if (!opt) return true;
  if (opt.categoryId === "lighting_fittings") return true;
  if ((opt.tags || []).includes("keypad")) return true;
  return false;
}

function computeNetworkPorts() {
  if (!state.includeNetwork) return { ports: 0, switches: 0, routerCost: 0, switchCost: 0, totalCost: 0 };

  const net = state.data?.network || null;
  if (!net) return { ports: 0, switches: 0, routerCost: 0, switchCost: 0, totalCost: 0 };

  let ports = 0;

  for (const room of state.rooms) {
    ports += computeRoomPorts(room);
  }

  const proc = computeLightingProcessorMode();
  if (proc.wiredUsed) ports += 1;
  if (proc.wirelessUsed) ports += 1;

  const apQty = Math.max(0, Number(state.project.accessPointsQty || 0));
  ports += apQty;

  const portsPerSwitch = Math.max(1, Number(net.switchPortsPerUnit || 23));
  const switches = ports > 0 ? Math.ceil(ports / portsPerSwitch) : 0;

  const routerCost = ports > 0 ? Number(net.routerCost || 0) : 0;
  const switchCost = Number(net.switchCost || 0) * switches;

  return { ports, switches, routerCost, switchCost, totalCost: routerCost + switchCost };
}

function computeRuleAddOnsExVat() {
  const addOns = [];

  addOns.push(...computeLightingProcessorAddOnsExVat());

  const net = computeNetworkPorts();
  if (state.includeNetwork && net.ports > 0) {
    addOns.push({
      id: "networkRouter",
      label: "Router",
      amountExVat: net.routerCost,
      detail: ""
    });

    addOns.push({
      id: "networkSwitches",
      label: "Switches",
      amountExVat: net.switchCost,
      detail: `${net.switches} switch${net.switches === 1 ? "" : "es"} for ${net.ports} ports`
    });
  }

  if (state.includeNetwork) {
    const apCost = Number(state.data?.network?.accessPointCost || 0);
    const apQty = Math.max(0, Number(state.project.accessPointsQty || 0));
    if (apQty > 0 && apCost > 0) {
      addOns.push({
        id: "wirelessAccessPoints",
        label: "Wireless access points",
        amountExVat: apQty * apCost,
        detail: `${apQty} × ${money(apCost)}`
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

  const addOnTotalExVat = addOns.reduce((sum, a) => sum + Number(a.amountExVat || 0), 0);

  const subLow = baseLow + addOnTotalExVat;
  const subHigh = baseHigh + addOnTotalExVat;

  const vatLow = subLow * vatRate();
  const vatHigh = subHigh * vatRate();

  const totalIncLow = subLow + vatLow;
  const totalIncHigh = subHigh + vatHigh;

  return {
    addOns,
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
    byId("roomTotal").textContent = moneyRangeDisplay(applyVat(rt.low), applyVat(rt.high));
  } else {
    byId("roomTotal").textContent = money(0);
  }

  setVatModeUI();
}

function renderProjectControls() {
  const host = byId("projectControls");
  if (!host) return;

  host.innerHTML = "";

  if (!state.includeNetwork) return;

  const block = document.createElement("div");
  block.className = "summaryBlock";
  block.style.marginTop = "0";
  block.style.marginBottom = "12px";

  const title = document.createElement("div");
  title.className = "subtitle";
  title.textContent = "Project network";
  block.appendChild(title);

  const row = document.createElement("div");
  row.className = "optionRow";
  row.style.marginBottom = "0";

  const main = document.createElement("div");
  main.className = "optionMain";

  const label = document.createElement("div");
  label.className = "optionLabel";
  label.textContent = "Wireless access points";

  const price = document.createElement("div");
  price.className = "optionPrice";
  const apCost = Number(state.data?.network?.accessPointCost || 0);
  price.textContent = `${money(applyVat(apCost))} each`;

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
  val.textContent = String(Math.max(0, Number(state.project.accessPointsQty || 0)));

  const plus = document.createElement("button");
  plus.className = "qtyBtn";
  plus.type = "button";
  plus.textContent = "+";

  minus.addEventListener("click", () => {
    const next = Math.max(0, Number(state.project.accessPointsQty || 0) - 1);
    state.project.accessPointsQty = next;
    val.textContent = String(next);
    updateTotalsUI();
  });

  plus.addEventListener("click", () => {
    const next = Math.max(0, Number(state.project.accessPointsQty || 0) + 1);
    state.project.accessPointsQty = next;
    val.textContent = String(next);
    updateTotalsUI();
  });

  qtyWrap.appendChild(minus);
  qtyWrap.appendChild(val);
  qtyWrap.appendChild(plus);
  control.appendChild(qtyWrap);

  row.appendChild(main);
  row.appendChild(control);

  block.appendChild(row);
  host.appendChild(block);
}

function clearLightingSelectionsNotInMode(room) {
  const mode = room.lightingMode || "wireless";

  const removeIf = opt => {
    const tags = opt?.tags || [];
    const isWireless = tags.includes("keypad_wireless") || tags.includes("circuit_wireless");
    const isWired = tags.includes("keypad_wired") || tags.includes("circuit_wired") || tags.includes("motion_sensor");

    if (mode === "wireless") return isWired;
    if (mode === "wired") return isWireless;
    return false;
  };

  for (const optionId of Object.keys(room.qty)) {
    const opt = optionById(optionId);
    if (!opt) continue;
    if (removeIf(opt)) delete room.qty[optionId];
  }

  for (const groupId of Object.keys(room.choice)) {
    const opt = optionById(room.choice[groupId]);
    if (!opt) continue;
    if (removeIf(opt)) delete room.choice[groupId];
  }

  if (state.useRanges) {
    for (const fam of rangeFamilies()) {
      if (fam.categoryId !== "lighting_control") continue;
      if (!fam.mode) continue;

      const shouldRemove =
        (mode === "wireless" && fam.mode === "wired") ||
        (mode === "wired" && fam.mode === "wireless");

      if (shouldRemove) delete room.rangeQty[fam.id];
    }
  }
}

function renderRoomModeToggle(room) {
  const host = byId("roomModeToggle");
  if (!host) return;

  host.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.gap = "8px";
  wrap.style.alignItems = "center";

  const btnWireless = document.createElement("button");
  btnWireless.type = "button";
  btnWireless.className = "btn btnGhost";
  btnWireless.textContent = "Wireless";

  const btnWired = document.createElement("button");
  btnWired.type = "button";
  btnWired.className = "btn btnGhost";
  btnWired.textContent = "Wired";

  const active = room.lightingMode || "wireless";

  const setActiveStyle = (btn, on) => {
    btn.style.background = on ? "rgba(255, 255, 255, 0.22)" : "transparent";
  };

  setActiveStyle(btnWireless, active === "wireless");
  setActiveStyle(btnWired, active === "wired");

  btnWireless.addEventListener("click", () => {
    room.lightingMode = "wireless";
    clearLightingSelectionsNotInMode(room);
    renderActiveRoom();
    updateTotalsUI();
  });

  btnWired.addEventListener("click", () => {
    room.lightingMode = "wired";
    clearLightingSelectionsNotInMode(room);
    renderActiveRoom();
    updateTotalsUI();
  });

  wrap.appendChild(btnWireless);
  wrap.appendChild(btnWired);
  host.appendChild(wrap);
}

function renderSubheading(text) {
  const h = document.createElement("div");
  h.className = "categoryTitle";
  h.textContent = text;
  h.style.marginTop = "14px";
  h.style.marginBottom = "8px";
  h.style.opacity = "0.95";
  return h;
}

function priceTextForOption(room, opt) {
  const unitEx = resolveDynamicUnitPriceExVat(room, opt);

  if (opt.inputType === "qty") {
    const hasGroupedAddon = Boolean(opt.roomAddon) && Number(opt.roomAddon.amount || 0) > 0 && Number(opt.roomAddon.every || 0) > 0;
    const unitIsZero = Number(unitEx || 0) === 0;

    if (hasGroupedAddon && unitIsZero) {
      const every = Number(opt.roomAddon.every);
      const amount = Number(opt.roomAddon.amount);
      return `${money(applyVat(amount))} per group of up to ${every}`;
    }

    return `${money(applyVat(unitEx))} each`;
  }

  return `${money(applyVat(unitEx))}`;
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
  price.textContent = priceTextForOption(room, opt);

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
      renderActiveRoom();
    });

    plus.addEventListener("click", () => {
      const next = Math.max(0, Number(room.qty[opt.id] || 0) + 1);
      room.qty[opt.id] = next;
      val.textContent = String(next);
      updateTotalsUI();
      renderActiveRoom();
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

function renderActiveRoom() {
  const room = state.rooms[state.activeRoomIndex];
  if (!room) return;

  if (!room.lightingMode) room.lightingMode = "wireless";

  byId("activeRoomTitle").textContent = room.name;
  byId("activeRoomMeta").textContent = room.type;

  renderRoomModeToggle(room);
  renderProjectControls();

  clearLightingSelectionsNotInMode(room);

  const wrap = byId("optionsWrap");
  wrap.innerHTML = "";

  for (const cat of state.data.categories) {
    const famsAll = rangeFamiliesByCategory(cat.id);
    const optsBase = optionsByCategory(cat.id);

    const isLightingControl = cat.id === "lighting_control";
    const mode = room.lightingMode || "wireless";

    const fams = isLightingControl
      ? famsAll.filter(f => !f.mode || f.mode === mode)
      : famsAll;

    const opts = optsBase.filter(o => {
      if (state.useRanges && optionIsHiddenByRangeFamilies(o)) return false;

      if (!isLightingControl) return true;

      const tags = o.tags || [];
      const isWireless = tags.includes("keypad_wireless") || tags.includes("circuit_wireless");
      const isWired = tags.includes("keypad_wired") || tags.includes("circuit_wired") || tags.includes("motion_sensor");

      if (mode === "wireless") return !isWired;
      if (mode === "wired") return !isWireless;

      return true;
    });

    const shouldRenderRangeRows = state.useRanges && fams.length > 0;
    const shouldRenderOpts = opts.length > 0;

    if (!shouldRenderRangeRows && !shouldRenderOpts) continue;

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

    if (isLightingControl) {
      const keypads = opts.filter(o => (o.tags || []).includes(mode === "wireless" ? "keypad_wireless" : "keypad_wired"));
      const motion = opts.filter(o => (o.tags || []).includes("motion_sensor"));
      const circuits = opts.filter(o => (o.tags || []).includes(mode === "wireless" ? "circuit_wireless" : "circuit_wired"));

      const used = new Set([
        ...keypads.map(o => o.id),
        ...motion.map(o => o.id),
        ...circuits.map(o => o.id)
      ]);

      const other = opts.filter(o => !used.has(o.id));

      if (!state.useRanges && keypads.length) {
        section.appendChild(renderSubheading(mode === "wireless" ? "Wireless keypads" : "Wired keypads"));
        for (const opt of keypads) section.appendChild(renderOptionRow(room, opt));
      }

      if (motion.length) {
        section.appendChild(renderSubheading("Motion sensors"));
        for (const opt of motion) section.appendChild(renderOptionRow(room, opt));
      }

      if (circuits.length) {
        section.appendChild(renderSubheading(mode === "wireless" ? "Wireless circuits" : "Wired circuits"));
        for (const opt of circuits) section.appendChild(renderOptionRow(room, opt));
      }

      if (other.length) {
        section.appendChild(renderSubheading("Other"));
        for (const opt of other) section.appendChild(renderOptionRow(room, opt));
      }
    } else {
      for (const opt of opts) section.appendChild(renderOptionRow(room, opt));
    }

    wrap.appendChild(section);
  }

  updateTotalsUI();
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
    const rt = getRoomBaseTotalsExVat(room);
    right.textContent = moneyRangeDisplay(applyVat(rt.low), applyVat(rt.high));

    head.appendChild(left);
    head.appendChild(right);
    block.appendChild(head);

    const list = document.createElement("div");
    list.className = "summaryList";

    for (const [optionId, qty] of Object.entries(room.qty)) {
      const opt = optionById(optionId);
      if (!opt) continue;

      const q = Number(qty || 0);
      const unitEx = resolveDynamicUnitPriceExVat(room, opt);

      const hasGroupedAddon = Boolean(opt.roomAddon) && Number(opt.roomAddon.amount || 0) > 0 && Number(opt.roomAddon.every || 0) > 0;
      const unitIsZero = Number(unitEx || 0) === 0;
      const shouldSuppressZeroLine = opt.inputType === "qty" && unitIsZero && hasGroupedAddon;

      if (!shouldSuppressZeroLine) {
        const lineTotal = unitEx * q;

        const line = document.createElement("div");
        line.className = "summaryLine";
        line.innerHTML = `<div>${opt.label} × ${q}</div><div>${money(applyVat(lineTotal))}</div>`;
        list.appendChild(line);
      }

      const addon = computeRoomOptionAddonExVat(opt, q);
      if (addon > 0) {
        const every = Number(opt.roomAddon.every);
        const amount = Number(opt.roomAddon.amount);
        const groups = Math.ceil(q / every);

        const addonLine = document.createElement("div");
        addonLine.className = "summaryLine";

        addonLine.innerHTML =
          `<div>${opt.label}: ${q} ${q === 1 ? "item" : "items"} (${groups} group${groups === 1 ? "" : "s"} × ${money(applyVat(amount))})</div>` +
          `<div>${money(applyVat(addon))}</div>`;

        list.appendChild(addonLine);
      }
    }

    for (const optionId of Object.values(room.choice)) {
      const opt = optionById(optionId);
      if (!opt) continue;

      const unitEx = resolveDynamicUnitPriceExVat(room, opt);

      const line = document.createElement("div");
      line.className = "summaryLine";
      line.innerHTML = `<div>${opt.label}</div><div>${money(applyVat(unitEx))}</div>`;
      list.appendChild(line);
    }

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
      for (const room of state.rooms) clearLightingSelectionsNotInMode(room);
      if (state.step === 2) renderActiveRoom();
      if (state.step === 3) renderSummary();
      updateTotalsUI();
    });
  }

  const networkToggle = byId("networkToggle");
  if (networkToggle) {
    networkToggle.addEventListener("change", e => {
      state.includeNetwork = Boolean(e.target.checked);
      if (!state.includeNetwork) state.project.accessPointsQty = 0;
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

  const networkToggle = byId("networkToggle");
  if (networkToggle) {
    networkToggle.checked = false;
    state.includeNetwork = false;
  }

  setVatModeUI();
  showStep(1);
}

main().catch(err => {
  console.error(err);
  document.body.innerHTML =
    `<div style="padding:20px;font-family:system-ui;color:white;">Error loading calculator. Open the browser console for details.</div>`;
});
