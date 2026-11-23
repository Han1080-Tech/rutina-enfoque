
const SCHEDULES = {
  LMV: ["Lunes", "Miércoles", "Viernes"],
  LV: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]
};

const PALETTE = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4", "#6366f1"];

let state = null;
let currentFilter = "ALL";
let timerInterval = null;
let remainingSeconds = 0;
let currentRotation = 0;
let isSpinning = false;

const SoundFX = {
  ctx: null,
  play(freq, duration = 0.1, type = "sine") {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.07, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (_) {}
  },
  success() {
    this.play(523.25, 0.1, "triangle");
    setTimeout(() => this.play(659.25, 0.15, "triangle"), 90);
  },
  error() {
    this.play(180, 0.2, "sawtooth");
  },
  tick() {
    this.play(700, 0.03, "square");
  }
};

function getNextDayForSchedule(scheduleType, currentDay) {
  const days = SCHEDULES[scheduleType] || SCHEDULES.LMV;
  const idx = days.indexOf(currentDay);
  return days[(idx + 1) % days.length];
}

function ensureGoalQueue(goal) {
  const days = SCHEDULES[goal.scheduleType] || SCHEDULES.LMV;
  while (goal.queue.length < 6) {
    const lastDay = goal.queue.length > 0 ? goal.queue[goal.queue.length - 1].day : days[days.length - 1];
    goal.queue.push({
      day: getNextDayForSchedule(goal.scheduleType, lastDay),
      target: goal.baseTarget,
      compensated: false
    });
  }
}

async function commitAndRender() {
  state.goals.forEach(ensureGoalQueue);
  await StorageService.saveState(state);
  renderAll();
}

// --- MÓDULO 1: RUTINA DIARIA ---
async function handleAddDailyBlock(e) {
  e.preventDefault();
  const time = document.getElementById("daily-time").value;
  const title = document.getElementById("daily-title").value.trim();
  const floor = document.getElementById("daily-floor").value.trim();
  if (!title) return;

  state.dailyBlocks.push({
    id: "d_" + Date.now(),
    time,
    title,
    minFloor: floor ? `Piso mínimo: ${floor}` : "Piso mínimo: Hacer 5 minutos",
    reward: 15,
    done: false
  });

  state.dailyBlocks.sort((a, b) => a.time.localeCompare(b.time));
  document.getElementById("daily-title").value = "";
  document.getElementById("daily-floor").value = "";
  SoundFX.play(440, 0.08);
  await commitAndRender();
}

async function toggleDailyBlock(id) {
  const block = state.dailyBlocks.find((b) => b.id === id);
  if (!block) return;

  block.done = !block.done;
  if (block.done) {
    state.gameMinutes += block.reward;
    state.xp += 25;
    SoundFX.success();
    // Si completa todos los bloques del día, gana 1 ficha de ruleta
    if (state.dailyBlocks.every((b) => b.done)) {
      state.wheelTokens += 1;
      state.xp += 50;
    }
  } else {
    state.gameMinutes = Math.max(0, state.gameMinutes - block.reward);
    state.xp = Math.max(0, state.xp - 25);
  }
  await commitAndRender();
}

async function deleteDailyBlock(id) {
  state.dailyBlocks = state.dailyBlocks.filter((b) => b.id !== id);
  await commitAndRender();
}

// --- MÓDULO 3: METAS CON COMPENSACIÓN ---
async function handleCreateGoal(e) {
  e.preventDefault();
  const title = document.getElementById("goal-title").value.trim();
  const unit = document.getElementById("goal-unit").value.trim();
  const total = Number(document.getElementById("goal-total").value);
  const baseTarget = Number(document.getElementById("goal-base").value);
  const scheduleType = document.getElementById("goal-schedule").value;

  if (!title || !unit || total < 1) return;

  const days = SCHEDULES[scheduleType];
  const initialQueue = Array.from({ length: 6 }, (_, i) => ({
    day: days[i % days.length],
    target: baseTarget,
    compensated: false
  }));

  state.goals.push({
    id: "g_" + Date.now(),
    title,
    unit,
    total,
    done: 0,
    todayDone: 0,
    scheduleType,
    baseTarget,
    rewardPerUnit: 15,
    queue: initialQueue
  });

  e.target.reset();
  document.getElementById("goal-form").hidden = true;
  SoundFX.success();
  await commitAndRender();
}

async function addGoalUnit(goalId) {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal || goal.done >= goal.total) return;

  goal.done += 1;
  goal.todayDone += 1;
  state.gameMinutes += goal.rewardPerUnit;
  state.xp += 25;
  SoundFX.success();

  const effectiveTarget = state.lowEnergyMode ? 1 : goal.queue[0].target;
  if (goal.todayDone === effectiveTarget) {
    state.wheelTokens += 1;
    state.xp += 40;
  }

  await commitAndRender();
}

async function closeGoalSession(goalId) {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) return;

  // Si usó Modo Energía Baja e hizo menos de la cuota original, compensamos la diferencia
  const pending = Math.max(0, goal.queue[0].target - goal.todayDone);
  goal.queue.shift();
  goal.todayDone = 0;
  ensureGoalQueue(goal);

  for (let i = 0; i < pending; i++) {
    goal.queue[i % goal.queue.length].target += 1;
    goal.queue[i % goal.queue.length].compensated = true;
  }

  SoundFX.success();
  await commitAndRender();
}

async function missGoalDay(goalId) {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) return;

  const pending = Math.max(0, goal.queue[0].target - goal.todayDone);
  goal.queue.shift();
  goal.todayDone = 0;
  ensureGoalQueue(goal);

  for (let i = 0; i < pending; i++) {
    if (i >= goal.queue.length) {
      const lastDay = goal.queue[goal.queue.length - 1].day;
      goal.queue.push({
        day: getNextDayForSchedule(goal.scheduleType, lastDay),
        target: goal.baseTarget,
        compensated: false
      });
    }
    goal.queue[i].target += 1;
    goal.queue[i].compensated = true;
  }

  SoundFX.play(320, 0.15, "triangle");
  await commitAndRender();
}

async function deleteGoal(goalId) {
  state.goals = state.goals.filter((g) => g.id !== goalId);
  await commitAndRender();
}

// --- MÓDULO 4: KANBAN GENERAL ---
async function handleCreateTask(e) {
  e.preventDefault();
  const title = document.getElementById("task-title").value.trim();
  const category = document.getElementById("task-category").value;
  const priority = document.getElementById("task-priority").value;
  const rewardMinutes = Number(document.getElementById("task-reward").value);

  if (!title) return;

  state.tasks.push({
    id: "t_" + Date.now(),
    title,
    category,
    priority,
    rewardMinutes,
    status: "todo"
  });

  document.getElementById("task-title").value = "";
  SoundFX.play(440, 0.08);
  await commitAndRender();
}

async function moveTask(id, targetStatus) {
  if (targetStatus === "doing") {
    const alreadyDoing = state.tasks.some((t) => t.status === "doing");
    if (alreadyDoing) {
      SoundFX.error();
      alert("Bloqueo de enfoque activo: termina o pausa tu tarea 'En Curso' antes de abrir otra.");
      return;
    }
  }

  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;

  task.status = targetStatus;

  if (targetStatus === "done") {
    state.gameMinutes += task.rewardMinutes;
    state.xp += task.priority === "necesaria" ? 60 : 35;
    state.wheelTokens += 1;
    SoundFX.success();
  } else {
    SoundFX.play(480, 0.08);
  }

  await commitAndRender();
}

async function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  await commitAndRender();
}

// --- MÓDULO 2: RULETA ---
async function handleAddPrize(e) {
  e.preventDefault();
  const label = document.getElementById("prize-label").value.trim();
  const type = document.getElementById("prize-type").value;
  if (!label) return;

  const value = type === "minutes" ? 20 : type === "xp" ? 100 : 0;
  const color = PALETTE[state.prizes.length % PALETTE.length];

  state.prizes.push({
    id: "p_" + Date.now(),
    label,
    color,
    type,
    value
  });

  document.getElementById("prize-label").value = "";
  await commitAndRender();
}

async function deletePrize(id) {
  if (state.prizes.length <= 2) {
    alert("Deja al menos 2 premios en la ruleta.");
    return;
  }
  state.prizes = state.prizes.filter((p) => p.id !== id);
  await commitAndRender();
}

function getWheelSegments() {
  const mode = document.getElementById("wheel-mode").value;
  if (mode === "premios") return state.prizes;

  const pending = state.tasks.filter((t) => t.status === "todo");
  if (pending.length === 0) {
    return [{ label: "Sin tareas pendientes", color: "#4b5563", type: "none" }];
  }

  const segments = [];
  pending.forEach((task) => {
    const shortName = task.title.length > 18 ? task.title.slice(0, 18) + "…" : task.title;
    const baseColor = task.priority === "necesaria" ? "#ef4444" : "#3b82f6";
    segments.push({ label: shortName, color: baseColor, type: "task", taskId: task.id });
    if (task.priority === "necesaria") {
      segments.push({ label: `★ ${shortName}`, color: "#dc2626", type: "task", taskId: task.id });
    }
  });
  return segments;
}

function drawWheel() {
  const canvas = document.getElementById("wheel-canvas");
  const ctx = canvas.getContext("2d");
  const segments = getWheelSegments();
  const count = segments.length;
  const arc = (2 * Math.PI) / count;
  const radius = canvas.width / 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  segments.forEach((seg, i) => {
    const startAngle = currentRotation + i * arc;
    const endAngle = startAngle + arc;

    ctx.beginPath();
    ctx.moveTo(radius, radius);
    ctx.arc(radius, radius, radius - 4, startAngle, endAngle);
    ctx.fillStyle = seg.color;
    ctx.fill();
    ctx.strokeStyle = "#0f1115";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(radius, radius);
    ctx.rotate(startAngle + arc / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(seg.label, radius - 14, 4);
    ctx.restore();
  });
}

async function spinWheel() {
  if (isSpinning) return;
  const mode = document.getElementById("wheel-mode").value;

  if (mode === "premios" && state.wheelTokens <= 0) {
    SoundFX.error();
    document.getElementById("wheel-result").textContent =
      "Necesitas 1 ficha. Completa una tarea, un bloque diario o tu sesión de meta.";
    return;
  }

  const segments = getWheelSegments();
  if (segments[0].type === "none") return;

  if (mode === "premios") {
    state.wheelTokens -= 1;
  }

  isSpinning = true;
  const extraSpins = 5 + Math.random() * 4;
  const targetRotation = currentRotation + extraSpins * 2 * Math.PI;
  const duration = 2500;
  const start = performance.now();
  const initialRotation = currentRotation;
  let lastTickSlice = -1;

  function animate(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    currentRotation = initialRotation + (targetRotation - initialRotation) * easeOut;

    const arc = (2 * Math.PI) / segments.length;
    const slice = Math.floor(((currentRotation % (2 * Math.PI)) + 2 * Math.PI) / arc);
    if (slice !== lastTickSlice) {
      SoundFX.tick();
      lastTickSlice = slice;
    }

    drawWheel();

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      isSpinning = false;
      resolveWheelOutcome(segments);
    }
  }

  requestAnimationFrame(animate);
}

async function resolveWheelOutcome(segments) {
  const count = segments.length;
  const arc = (2 * Math.PI) / count;
  const pointerAngle = (3 * Math.PI) / 2;
  const normalized = ((pointerAngle - currentRotation) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const winner = segments[Math.floor(normalized / arc)];
  const resultBox = document.getElementById("wheel-result");

  SoundFX.success();

  if (winner.type === "minutes") {
    state.gameMinutes += winner.value;
    resultBox.textContent = `¡Ganaste ${winner.label}! Sumados a tu banco de juego.`;
  } else if (winner.type === "xp") {
    state.xp += winner.value;
    resultBox.textContent = `¡Ganaste +${winner.value} XP!`;
  } else if (winner.type === "skip_unit") {
    const targetGoal = state.goals.find((g) => g.queue[0].target > 1);
    if (targetGoal) {
      targetGoal.queue[0].target -= 1;
      const last = targetGoal.queue[targetGoal.queue.length - 1];
      last.target += 1;
      last.compensated = true;
      resultBox.textContent = `Comodín aplicado en "${targetGoal.title}": -1 ${targetGoal.unit} hoy.`;
    } else {
      state.gameMinutes += 15;
      resultBox.textContent = "Tus metas de hoy ya están al mínimo; recibes +15 min de juego.";
    }
  } else if (winner.type === "treat") {
    resultBox.textContent = `¡Premio desbloqueado: ${winner.label}! Disfrútalo sin culpa.`;
  } else if (winner.type === "task") {
    const hasDoing = state.tasks.some((t) => t.status === "doing");
    if (!hasDoing) {
      await moveTask(winner.taskId, "doing");
      resultBox.textContent = `La ruleta eligió y movió a En Curso: "${winner.label}"`;
      return;
    } else {
      resultBox.textContent = `Siguiente tarea elegida por la ruleta: "${winner.label}"`;
    }
  }

  await commitAndRender();
}

// --- TEMPORIZADOR DE JUEGO ---
function toggleGameTimer() {
  const btn = document.getElementById("btn-toggle-timer");

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
    btn.textContent = "Reanudar";
    return;
  }

  if (remainingSeconds <= 0 && state.gameMinutes > 0) {
    remainingSeconds = state.gameMinutes * 60;
  }
  if (remainingSeconds <= 0) return;

  btn.textContent = "Pausar";
  timerInterval = setInterval(async () => {
    remainingSeconds -= 1;
    state.gameMinutes = Math.ceil(remainingSeconds / 60);
    updateTimerDisplay();

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      state.gameMinutes = 0;
      SoundFX.error();
      await commitAndRender();
      alert("Tiempo de juego terminado. ¡De vuelta al tablero!");
    }
  }, 1000);
}

function updateTimerDisplay() {
  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  document.getElementById("game-timer-display").textContent =
    `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  document.getElementById("game-minutes").textContent = state.gameMinutes;
}

// --- RENDERIZADO GENERAL ---
function renderAll() {
  // Fecha y Modo Energía Baja
  document.getElementById("current-date-label").textContent = state.lastActiveDate;
  document.getElementById("toggle-low-energy").checked = state.lowEnergyMode;
  document.body.classList.toggle("low-energy-active", state.lowEnergyMode);

  // Nivel y XP
  const level = Math.floor(state.xp / 200) + 1;
  const currentLevelXp = state.xp % 200;
  document.getElementById("level-badge").textContent = `Nivel ${level}`;
  document.getElementById("xp-bar").style.width = `${(currentLevelXp / 200) * 100}%`;
  document.getElementById("xp-text").textContent = `${currentLevelXp} / 200 XP`;

  // Banco de juego
  if (!timerInterval) remainingSeconds = state.gameMinutes * 60;
  updateTimerDisplay();
  const timerBtn = document.getElementById("btn-toggle-timer");
  timerBtn.disabled = state.gameMinutes <= 0 && remainingSeconds <= 0;
  if (!timerInterval) timerBtn.textContent = "Jugar";

  // 1. Rutina Diaria
  const dailyDoneCount = state.dailyBlocks.filter((b) => b.done).length;
  document.getElementById("daily-progress-badge").textContent = `${dailyDoneCount} / ${state.dailyBlocks.length}`;

  const dailyListEl = document.getElementById("daily-list");
  dailyListEl.innerHTML = state.dailyBlocks
    .map(
      (b) => `
      <div class="daily-item ${b.done ? "done" : ""}">
        <div class="daily-left">
          <input type="checkbox" ${b.done ? "checked" : ""} onchange="toggleDailyBlock('${b.id}')" />
          <span class="daily-time">${b.time}</span>
          <div>
            <div class="daily-text">${state.lowEnergyMode ? b.minFloor : b.title}</div>
            ${!state.lowEnergyMode ? `<span class="floor-hint">${b.minFloor}</span>` : ""}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:0.4rem;">
          <span class="muted">+${b.reward}m</span>
          <button class="btn btn-ghost btn-sm" onclick="deleteDailyBlock('${b.id}')">✕</button>
        </div>
      </div>
    `
    )
    .join("");

  // 2. Ruleta y editor de premios
  document.getElementById("wheel-tokens").textContent = state.wheelTokens;
  document.getElementById("prize-tags").innerHTML = state.prizes
    .map(
      (p) =>
        `<span class="prize-chip">${p.label} <button type="button" onclick="deletePrize('${p.id}')">×</button></span>`
    )
    .join("");
  drawWheel();

  // 3. Metas Progresivas
  const goalsContainer = document.getElementById("goals-container");
  goalsContainer.innerHTML = state.goals
    .map((g) => {
      const pct = Math.min(100, Math.round((g.done / g.total) * 100));
      const todaySession = g.queue[0];
      const effectiveTarget = state.lowEnergyMode ? 1 : todaySession.target;
      const isCompleteToday = g.todayDone >= effectiveTarget;

      const pillsHTML = g.queue
        .slice(0, 5)
        .map((q, idx) => {
          const cls = ["day-pill"];
          if (idx === 0) cls.push("today");
          if (q.compensated) cls.push("compensated");
          return `<div class="${cls.join(" ")}"><strong>${idx === 0 ? `Hoy (${q.day})` : q.day}</strong><br/>${q.target} ${g.unit}</div>`;
        })
        .join("");

      return `
        <div class="goal-card">
          <div class="goal-top">
            <div>
              <div class="goal-title">${g.title}</div>
              <span class="muted">${g.done} / ${g.total} ${g.unit} (${pct}%) · Esquema ${g.scheduleType}</span>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="deleteGoal('${g.id}')">✕</button>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="session-strip">
            <div>
              <span class="muted">Hoy (${state.lowEnergyMode ? "Piso mínimo" : "Cuota"}):</span><br/>
              <strong>${g.todayDone} / ${effectiveTarget} ${g.unit}</strong>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:0.35rem;">
              <button class="btn btn-primary btn-sm" onclick="addGoalUnit('${g.id}')">+1 ${g.unit.slice(0, -1) || g.unit}</button>
              ${isCompleteToday ? `<button class="btn btn-success btn-sm" onclick="closeGoalSession('${g.id}')">Cerrar Hoy ✓</button>` : ""}
              <button class="btn btn-warning btn-sm" onclick="missGoalDay('${g.id}')">Compensar</button>
            </div>
          </div>
          <div class="queue-pills">${pillsHTML}</div>
        </div>
      `;
    })
    .join("");

  // 4. Kanban General
  const colTodo = document.getElementById("col-todo");
  const colDoing = document.getElementById("col-doing");
  const colDone = document.getElementById("col-done");
  colTodo.innerHTML = "";
  colDoing.innerHTML = "";
  colDone.innerHTML = "";

  const sortedTasks = [...state.tasks].sort((a, b) => {
    if (a.priority === b.priority) return 0;
    return a.priority === "necesaria" ? -1 : 1;
  });

  const hasDoing = state.tasks.some((t) => t.status === "doing");
  const lockMsg = document.getElementById("doing-lock-msg");
  lockMsg.textContent = hasDoing
    ? "Bloqueado: 1 tarea en curso (termina o pausa antes de abrir otra)"
    : "Disponible: Puedes enfocar 1 tarea";
  lockMsg.classList.toggle("locked", hasDoing);

  sortedTasks.forEach((task) => {
    if (task.status === "todo" && currentFilter !== "ALL" && task.category !== currentFilter) {
      return;
    }

    const card = document.createElement("div");
    card.className = `task-card ${task.priority}`;

    const badge =
      task.priority === "necesaria"
        ? `<span class="pill-necesaria">● NECESARIA</span>`
        : `<span class="pill-deseo">● Quiero hacer</span>`;

    let buttons = "";
    if (task.status === "todo") {
      buttons = `
        <button class="btn btn-primary btn-sm" onclick="moveTask('${task.id}', 'doing')" ${hasDoing ? "disabled" : ""}>Enfocar</button>
        <button class="btn btn-ghost btn-sm" onclick="deleteTask('${task.id}')">✕</button>
      `;
    } else if (task.status === "doing") {
      buttons = `
        <button class="btn btn-success btn-sm" onclick="moveTask('${task.id}', 'done')">✓ Completar (+${task.rewardMinutes}m)</button>
        <button class="btn btn-warning btn-sm" onclick="moveTask('${task.id}', 'todo')">Pausar</button>
      `;
    } else {
      buttons = `<span class="muted">Completada (+${task.rewardMinutes} min)</span>`;
    }

    card.innerHTML = `
      <div class="task-meta">
        <div>${badge} <span class="cat-badge">${task.category}</span></div>
        <span>+${task.rewardMinutes}m</span>
      </div>
      <div class="task-title">${task.title}</div>
      <div class="task-actions">${buttons}</div>
    `;

    if (task.status === "todo") colTodo.appendChild(card);
    else if (task.status === "doing") colDoing.appendChild(card);
    else colDone.appendChild(card);
  });
}

// --- INICIALIZACIÓN ---
window.addEventListener("DOMContentLoaded", async () => {
  state = await StorageService.loadState();

  document.getElementById("toggle-low-energy").addEventListener("change", async (e) => {
    state.lowEnergyMode = e.target.checked;
    await commitAndRender();
  });

  document.getElementById("daily-form").addEventListener("submit", handleAddDailyBlock);
  document.getElementById("btn-toggle-goal-form").addEventListener("click", () => {
    const form = document.getElementById("goal-form");
    form.hidden = !form.hidden;
  });
  document.getElementById("goal-form").addEventListener("submit", handleCreateGoal);

  document.getElementById("btn-toggle-prizes").addEventListener("click", () => {
    const editor = document.getElementById("prize-editor");
    editor.hidden = !editor.hidden;
  });
  document.getElementById("prize-form").addEventListener("submit", handleAddPrize);

  document.getElementById("task-form").addEventListener("submit", handleCreateTask);
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      currentFilter = chip.dataset.filter;
      renderAll();
    });
  });

  document.getElementById("btn-spin").addEventListener("click", spinWheel);
  document.getElementById("wheel-mode").addEventListener("change", drawWheel);
  document.getElementById("btn-toggle-timer").addEventListener("click", toggleGameTimer);

  renderAll();
});