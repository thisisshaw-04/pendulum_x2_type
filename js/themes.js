const THEME_STORAGE_KEY = "pendulum-theme";

const THEMES = {
  neobrut: {
    label: "Neobrut",
    bg: "#ffffff",
    trace: "#000000",
  },
  doodle: {
    label: "Doodle",
    bg: "#f2efe6",
    trace: "#2d2926",
  },
  retro: {
    label: "Retro",
    bg: "#c0c0c0",
    trace: "#000000",
  },
  y2k: {
    label: "Y2K",
    bg: "#f4f8ff",
    trace: "#3d3560",
  },
  matrix: {
    label: "Matrix",
    bg: "#020f08",
    trace: "#00ff41",
  },
};

function getThemeIds() {
  return Object.keys(THEMES);
}

function getStoredThemeId() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "product") return "matrix";
  if (saved && THEMES[saved]) return saved;
  return "neobrut";
}

function setThemeOptionState(activeId) {
  document.querySelectorAll(".theme-option").forEach((btn) => {
    const active = btn.dataset.themeId === activeId;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function applyThemeColors(theme) {
  const bgInput = document.getElementById("bg-color");
  const traceInput = document.getElementById("tracer-color");
  if (bgInput) {
    bgInput.value = theme.bg;
    bgInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (traceInput) {
    traceInput.value = theme.trace;
    traceInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function applyTheme(themeId, { persist = true, updateColors = true } = {}) {
  const id = THEMES[themeId] ? themeId : "neobrut";
  const theme = THEMES[id];
  document.documentElement.dataset.theme = id;
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, id);
  setThemeOptionState(id);
  if (updateColors) applyThemeColors(theme);
  return id;
}

function buildThemePicker() {
  const picker = document.getElementById("theme-picker");
  if (!picker) return;

  picker.replaceChildren();
  for (const [id, theme] of Object.entries(THEMES)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-option";
    btn.dataset.themeId = id;
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = theme.label;
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyTheme(id);
    });
    picker.appendChild(btn);
  }
}

function initThemes() {
  buildThemePicker();
  applyTheme(getStoredThemeId(), { persist: false });
}
