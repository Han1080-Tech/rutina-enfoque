const STORAGE_KEY = "rutina_general_v2";

// PEGA AQUÍ TU CONFIGURACIÓN REAL DE FIREBASE CONSOLE
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyASVoupzzeD-aY0kLgeMm06rmZHfFZctV8",
  authDomain: "rutina-enfoque.firebaseapp.com",
  projectId: "rutina-enfoque",
  storageBucket: "rutina-enfoque.firebasestorage.app",
  messagingSenderId: "587087409350",
  appId: "1:587087409350:web:93d7a66f2bf532d98be7c7",
  measurementId: "G-J9JHP690B1"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

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
    }
  ],
  prizes: [
    { id: "p1", label: "+15 min Juego", color: "#3b82f6", type: "minutes", value: 15 },
    { id: "p2", label: "Comodín -1 Unidad", color: "#10b981", type: "skip_unit", value: 1 },
    { id: "p3", label: "+30 min Juego", color: "#8b5cf6", type: "minutes", value: 30 },
    { id: "p4", label: "+100 XP Extra", color: "#f59e0b", type: "xp", value: 100 },
    { id: "p5", label: "Vale Helado / Snack", color: "#ec4899", type: "treat", value: 0 }
  ],
  tasks: [
    {
      id: "t1",
      title: "Avanzar documento / código de práctica",
      category: "Universidad",
      priority: "necesaria",
      rewardMinutes: 30,
      status: "todo"
    }
  ]
};

function applyDailyReset(state) {
  const today = getTodayISO();
  if (state.lastActiveDate !== today) {
    state.dailyBlocks.forEach((b) => (b.done = false));
    state.tasks = state.tasks.filter((t) => t.status !== "done");
    state.lastActiveDate = today;
    return true;
  }
  return false;
}

const StorageService = {
  currentUser: null,
  unsubscribeSnapshot: null,

  initAuth(onUserChanged, onRemoteState) {
    auth.onAuthStateChanged(async (user) => {
      this.currentUser = user;

      if (this.unsubscribeSnapshot) {
        this.unsubscribeSnapshot();
        this.unsubscribeSnapshot = null;
      }

      if (user) {
        const docRef = db.collection("users").doc(user.uid);
        this.unsubscribeSnapshot = docRef.onSnapshot((doc) => {
          if (!doc.exists || doc.metadata.hasPendingWrites) return;
          const remoteData = doc.data();
          delete remoteData.updatedAt;
          const merged = { ...structuredClone(DEFAULT_STATE), ...remoteData };
          const serialized = JSON.stringify(merged);
          if (serialized !== localStorage.getItem(STORAGE_KEY)) {
            localStorage.setItem(STORAGE_KEY, serialized);
            if (onRemoteState) onRemoteState(merged);
          }
        });
      }

      if (onUserChanged) await onUserChanged(user);
    });
  },

  async loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  },

  async logoutGoogle() {
    await auth.signOut();
  },

  loadLocalState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const state = raw
      ? { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) }
      : structuredClone(DEFAULT_STATE);
    applyDailyReset(state);
    return state;
  },

  async loadState() {
    const localState = this.loadLocalState();

    if (!this.currentUser) {
      return localState;
    }

    try {
      const docRef = db.collection("users").doc(this.currentUser.uid);
      const doc = await docRef.get();

      if (!doc.exists) {
        // Primera vez: sube tu progreso local existente a la nube
        await this.saveState(localState);
        return localState;
      }

      const cloudData = doc.data();
      delete cloudData.updatedAt;
      const merged = { ...structuredClone(DEFAULT_STATE), ...cloudData };
      const didReset = applyDailyReset(merged);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      if (didReset) await this.saveState(merged);
      return merged;
    } catch (error) {
      console.error("Error leyendo Firestore, usando respaldo local:", error);
      return localState;
    }
  },

  async saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    if (!this.currentUser) return;

    try {
      await db
        .collection("users")
        .doc(this.currentUser.uid)
        .set(
          {
            ...state,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
    } catch (error) {
      console.error("Error sincronizando con Firestore:", error);
    }
  }
};