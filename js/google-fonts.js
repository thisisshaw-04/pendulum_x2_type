/**
 * Google Fonts integration via gwfh.mranftl.com (serves fonts.gstatic.com files).
 */

const GWFH_API = "https://gwfh.mranftl.com/api";
const DEFAULT_FONT_ID = "open-sans";
const DEFAULT_FONT_URL =
  "https://cdn.jsdelivr.net/fontsource/fonts/open-sans@5.0.8/latin-400-normal.ttf";

/** Offline fallback — Google Font ids used by the gwfh API. */
const FALLBACK_FONTS = [
  { id: "open-sans", family: "Open Sans" },
  { id: "roboto", family: "Roboto" },
  { id: "lato", family: "Lato" },
  { id: "montserrat", family: "Montserrat" },
  { id: "poppins", family: "Poppins" },
  { id: "inter", family: "Inter" },
  { id: "raleway", family: "Raleway" },
  { id: "oswald", family: "Oswald" },
  { id: "merriweather", family: "Merriweather" },
  { id: "playfair-display", family: "Playfair Display" },
  { id: "nunito", family: "Nunito" },
  { id: "ubuntu", family: "Ubuntu" },
  { id: "rubik", family: "Rubik" },
  { id: "work-sans", family: "Work Sans" },
  { id: "dm-sans", family: "DM Sans" },
  { id: "libre-baskerville", family: "Libre Baskerville" },
  { id: "crimson-text", family: "Crimson Text" },
  { id: "pt-serif", family: "PT Serif" },
  { id: "fira-sans", family: "Fira Sans" },
  { id: "source-sans-3", family: "Source Sans 3" },
  { id: "karla", family: "Karla" },
  { id: "mulish", family: "Mulish" },
  { id: "cabin", family: "Cabin" },
  { id: "barlow", family: "Barlow" },
  { id: "josefin-sans", family: "Josefin Sans" },
  { id: "lora", family: "Lora" },
  { id: "bitter", family: "Bitter" },
  { id: "archivo", family: "Archivo" },
  { id: "cormorant", family: "Cormorant" },
  { id: "abril-fatface", family: "Abril Fatface" },
  { id: "bebas-neue", family: "Bebas Neue" },
  { id: "anton", family: "Anton" },
  { id: "pacifico", family: "Pacifico" },
  { id: "lobster", family: "Lobster" },
  { id: "dancing-script", family: "Dancing Script" },
  { id: "caveat", family: "Caveat" },
  { id: "permanent-marker", family: "Permanent Marker" },
  { id: "inconsolata", family: "Inconsolata" },
  { id: "space-mono", family: "Space Mono" },
];

const fontMeta = new Map();
let googleFontsList = [];
const previewFontsLoaded = new Set();
let fontPickerReady = false;
let fontPreviewObserver = null;

function getSelectedFontId() {
  return $("font-select")?.value || DEFAULT_FONT_ID;
}

function getFontLabel(id) {
  return fontMeta.get(id) || id.replace(/-/g, " ");
}

function pickRegularVariant(variants) {
  return (
    variants.find((v) => v.id === "regular") ||
    variants.find((v) => v.fontStyle === "normal" && String(v.fontWeight) === "400") ||
    variants.find((v) => v.fontStyle === "normal") ||
    variants[0]
  );
}

async function fetchGoogleFontsList() {
  const res = await fetch(`${GWFH_API}/fonts`);
  if (!res.ok) throw new Error("Font list unavailable");
  const list = await res.json();
  list.sort((a, b) => a.family.localeCompare(b.family));
  return list;
}

function fontsourceCdnUrl(fontId) {
  return `https://cdn.jsdelivr.net/fontsource/fonts/${fontId}@latest/latin-400-normal.ttf`;
}

async function resolveGoogleFontUrl(fontId) {
  try {
    const res = await fetch(`${GWFH_API}/fonts/${encodeURIComponent(fontId)}`);
    if (res.ok) {
      const data = await res.json();
      const variant = pickRegularVariant(data.variants || []);
      const url = variant?.ttf || variant?.woff2 || variant?.woff;
      if (url) return url;
    }
  } catch (_) {
    /* try CDN fallback below */
  }

  return fontsourceCdnUrl(fontId);
}

function indexFontList(list) {
  fontMeta.clear();
  list.forEach((f) => fontMeta.set(f.id, f.family));
}

function fontPreviewCssUrl(family) {
  const name = family.trim().replace(/\s+/g, "+");
  const text = encodeURIComponent(family.replace(/\s+/g, ""));
  return `https://fonts.googleapis.com/css2?family=${name}:wght@400&text=${text}&display=swap`;
}

function loadFontPreview(family) {
  if (!family || previewFontsLoaded.has(family)) return;
  previewFontsLoaded.add(family);

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = fontPreviewCssUrl(family);
  document.head.appendChild(link);
}

function positionFontList() {
  const list = $("font-select-list");
  const trigger = $("font-select-trigger");
  if (!list || !trigger || list.hidden) return;

  const rect = trigger.getBoundingClientRect();
  const gap = 2;
  const maxH = Math.min(280, window.innerHeight - rect.bottom - gap - 12);

  list.style.left = `${Math.round(rect.left)}px`;
  list.style.top = `${Math.round(rect.bottom + gap)}px`;
  list.style.width = `${Math.round(rect.width)}px`;
  list.style.maxHeight = `${Math.max(120, maxH)}px`;
}

function openFontPicker() {
  const list = $("font-select-list");
  const trigger = $("font-select-trigger");
  const picker = $("font-picker");
  if (!list || !trigger) return;

  list.hidden = false;
  picker?.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");
  positionFontList();

  const selected = list.querySelector('.font-picker-option[aria-selected="true"]');
  selected?.scrollIntoView({ block: "nearest" });
}

function closeFontPicker() {
  const list = $("font-select-list");
  const trigger = $("font-select-trigger");
  const picker = $("font-picker");
  if (list) list.hidden = true;
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  picker?.classList.remove("is-open");
}

function syncFontPickerUI() {
  const sel = $("font-select");
  const label = $("font-select-label");
  const trigger = $("font-select-trigger");
  if (!sel || !label) return;

  const id = sel.value;
  const family = getFontLabel(id);
  label.textContent = family;
  loadFontPreview(family);

  if (trigger) {
    trigger.style.fontFamily = `"${family}", sans-serif`;
    trigger.disabled = sel.disabled;
  }

  document.querySelectorAll(".font-picker-option").forEach((btn) => {
    const selected = btn.dataset.fontId === id;
    btn.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected && !$("font-select-list")?.hidden) {
      btn.scrollIntoView({ block: "nearest" });
    }
  });
}

function initFontPickerEvents() {
  if (fontPickerReady) return;
  fontPickerReady = true;

  const picker = $("font-picker");
  const trigger = $("font-select-trigger");
  const list = $("font-select-list");
  const sel = $("font-select");

  trigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (sel?.disabled) return;
    if (list.hidden) openFontPicker();
    else closeFontPicker();
  });

  list?.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("click", (e) => {
    if (!picker?.contains(e.target) && !list?.contains(e.target)) closeFontPicker();
  });

  window.addEventListener("resize", () => positionFontList());
  window.addEventListener("scroll", () => positionFontList(), true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeFontPicker();
  });

  sel?.addEventListener("change", () => syncFontPickerUI());
}

function ensureFontPreviewObserver() {
  const list = $("font-select-list");
  if (!list) return;

  if (fontPreviewObserver) fontPreviewObserver.disconnect();

  fontPreviewObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) loadFontPreview(entry.target.dataset.fontFamily);
      });
    },
    { root: list, rootMargin: "80px" }
  );
}

function renderFontOptions() {
  const sel = $("font-select");
  const list = $("font-select-list");
  if (!sel || !list) return;

  const prev = sel.value;
  const sorted = [...googleFontsList].sort(
    (a, b) => (a.popularity ?? 9999) - (b.popularity ?? 9999)
  );

  sel.innerHTML = "";
  list.innerHTML = "";
  ensureFontPreviewObserver();

  for (const f of sorted) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.family;
    sel.appendChild(opt);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "font-picker-option";
    btn.dataset.fontId = f.id;
    btn.dataset.fontFamily = f.family;
    btn.setAttribute("role", "option");
    btn.style.fontFamily = `"${f.family}", sans-serif`;
    btn.textContent = f.family;
    btn.addEventListener("click", () => {
      sel.value = f.id;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      closeFontPicker();
      syncFontPickerUI();
    });
    list.appendChild(btn);
    fontPreviewObserver.observe(btn);
  }

  if (sorted.some((f) => f.id === prev)) {
    sel.value = prev;
  } else if (sorted.some((f) => f.id === DEFAULT_FONT_ID)) {
    sel.value = DEFAULT_FONT_ID;
  } else if (sorted.length > 0) {
    sel.value = sorted[0].id;
  }

  initFontPickerEvents();
  syncFontPickerUI();
}

function setFontControlsEnabled(enabled) {
  const sel = $("font-select");
  const trigger = $("font-select-trigger");
  if (sel) sel.disabled = !enabled;
  if (trigger) trigger.disabled = !enabled;
}

async function initGoogleFontsUI() {
  setFontControlsEnabled(false);
  setStatus("Loading Google Fonts…");

  try {
    googleFontsList = await fetchGoogleFontsList();
    indexFontList(googleFontsList);
    renderFontOptions();
    $("font-select").value = DEFAULT_FONT_ID;
    setStatus(`Google Fonts ready — ${googleFontsList.length} families`);
  } catch {
    googleFontsList = [...FALLBACK_FONTS];
    indexFontList(googleFontsList);
    renderFontOptions();
    $("font-select").value = DEFAULT_FONT_ID;
    setStatus(`Font list offline — ${FALLBACK_FONTS.length} fonts available`);
  }

  setFontControlsEnabled(true);
  syncFontPickerUI();
}
