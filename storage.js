const STORAGE_KEY = "rutina_general_v2";

function getTodayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DEFAULT_STATE = {
  lastActiveDate: getTodayISO(),
  lowEnergyMode: false,
  gameMinutes: 0,
  xp: 0,
  wheelTokens: 1,

  // 1. Bloques recurrentes del día (se reinician automáticamente cada día nuevo)
  dailyBlocks: [
    {
      id: "d1",
      time: "10:30",
      title: "Arranque: Bloque de estudio principal",
      minFloor: "Piso mínimo: 1 solo video o 10 min de lectura",
      reward: 15,
      done: false
    },
    {
      id: "d2",
      time: "16:00",
      title: "Japonés JLPT N5 (30 min)",
      minFloor: "Piso mínimo: Repasar 5 min de vocabulario",
      reward: 15,
      done: false
    },
    {
      id: "d3",
      time: "18:00",
      title: "Entrenamiento / Clase Taekwondo",
      minFloor: "Piso mínimo: Preparar equipo y botella de agua",
      reward: 20,
      done: false
    },
    {
      id: "d4",
      time: "21:00",
      title: "Cierre: Ordenar escritorio y preparar mañana",
      minFloor: "Piso mínimo: Dejar lista la 1ra tarea de mañana",
      reward: 10,
      done: false
    }
  ],

  // 2. Metas progresivas con compensación distribuida
  goals: [
    {
      id: "g1",
      title: "Curso Python y R (Meta Abril)",
      unit: "videos",
      total: 150,
      done: 0,
      todayDone: 0,
      scheduleType: "LMV",
      baseTarget: 3,
      rewardPerUnit: 15,
      queue: [
        { day: "Lunes", target: 3, compensated: false },
        { day: "Miércoles", target: 3, compensated: false },
        { day: "Viernes", target: 3, compensated: false },
        { day: "Lunes", target: 3, compensated: false },
        { day: "Miércoles", target: 3, compensated: false },
        { day: "Viernes", target: 3, compensated: false }
      ]
    },
    {
      id: "g2",
      title: "Sistema Torneos Taekwondo (Desarrollo)",
      unit: "módulos",
      total: 12,
      done: 0,
      todayDone: 0,
      scheduleType: "LMV",
      baseTarget: 1,
      rewardPerUnit: 25,
      queue: [
        { day: "Lunes", target: 1, compensated: false },
        { day: "Miércoles", target: 1, compensated: false },
        { day: "Viernes", target: 1, compensated: false },
        { day: "Lunes", target: 1, compensated: false },
        { day: "Miércoles", target: 1, compensated: false },
        { day: "Viernes", target: 1, compensated: false }
      ]
    }
  ],

  // 3. Premios editables de la ruleta
  prizes: [
    { id: "p1", label: "+15 min Juego", color: "#3b82f6", type: "minutes", value: 15 },
    { id: "p2", label: "Comodín -1 Unidad", color: "#10b981", type: "skip_unit", value: 1 },
    { id: "p3", label: "+30 min Juego", color: "#8b5cf6", type: "minutes", value: 30 },
    { id: "p4", label: "+100 XP Extra", color: "#f59e0b", type: "xp", value: 100 },
    { id: "p5", label: "Vale Helado / Snack", color: "#ec4899", type: "treat", value: 0 }
  ],

  // 4. Tablero Kanban general
  tasks: [
    {
      id: "t1",
      title: "Avanzar documento / código de práctica",
      category: "Universidad",
      priority: "necesaria",
      rewardMinutes: 30,
      status: "todo"
    },
    {
      id: "t2",
      title: "Probar flujo de gráficas en sistema local",
      category: "Proyecto",
      priority: "necesaria",
      rewardMinutes: 30,
      status: "todo"
    },
    {
      id: "t3",
      title: "Leer un capítulo de novela",
      category: "Personal",
      priority: "deseo",
      rewardMinutes: 15,
      status: "todo"
    }
  ]
};

const StorageService = {
  async loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const state = raw
        ? { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) }
        : structuredClone(DEFAULT_STATE);

      // Reinicio automático de bloques diarios al cambiar de fecha
      const today = getTodayISO();
      if (state.lastActiveDate !== today) {
        state.dailyBlocks.forEach((b) => (b.done = false));
        state.tasks = state.tasks.filter((t) => t.status !== "done");
        state.lastActiveDate = today;
        await this.saveState(state);
      }
      return state;
    } catch (error) {
      console.error("Error cargando estado:", error);
      return structuredClone(DEFAULT_STATE);
    }
  },

  async saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Error guardando estado:", error);
    }
  }
};