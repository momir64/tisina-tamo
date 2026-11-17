const api = globalThis.browser ?? chrome;

const DEFAULTS = {
  enabled: true,
  words: "Александар Вучић\nСрбија побеђује\nВучић", // one phrase per line
  caseSensitive: false,
  blurVideo: true, // blur the whole video while it is muted
  intervalMs: 300,
  holdScans: 3,
  region: { x: 26, y: 88, w: 48, h: 12 },
  hammingTolerance: 1, // wrong characters allowed when matching a phrase
  whitePercent: 86, // % of full brightness (86% = 220/255)
  debug: false,
};
const $ = (id) => document.getElementById(id);

// ---------- theme (system by default, toggle overrides and is remembered) ----------
function currentIsDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}
function updateThemeIcon() {
  const dark = currentIsDark();
  // SVG elements have no `.hidden` property, so toggle the attribute directly.
  $("icon-moon").toggleAttribute("hidden", dark);  // light mode: moon (click for dark)
  $("icon-sun").toggleAttribute("hidden", !dark);  // dark mode: sun (click for light)
}
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  updateThemeIcon();
}
updateThemeIcon();
api.storage.sync.get({ theme: "" }, (s) => applyTheme(s.theme));
$("theme").addEventListener("click", () => {
  const next = currentIsDark() ? "light" : "dark";
  applyTheme(next);
  api.storage.sync.set({ theme: next });
});

// ---------- phrase chips ----------
let words = [];
const chipsEl = $("chips");
const wordInput = $("wordInput");

function renderChips() {
  chipsEl.replaceChildren();
  words.forEach((w, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const text = document.createElement("span");
    text.textContent = w;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.title = x.ariaLabel = "Ukloni";
    x.addEventListener("click", () => {
      words.splice(i, 1);
      renderChips();
      scheduleSave();
    });
    chip.append(text, x);
    chipsEl.append(chip);
  });
}
function commitInput() {
  const w = wordInput.value.trim();
  wordInput.value = "";
  if (w && !words.includes(w)) {
    words.push(w);
    renderChips();
    scheduleSave();
  }
}
wordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    commitInput();
  } else if (e.key === "Backspace" && !wordInput.value && words.length) {
    words.pop();
    renderChips();
    scheduleSave();
  }
});
wordInput.addEventListener("blur", commitInput);
// Touch keyboards often don't send a usable Enter keydown, so also: a comma typed/pasted
// commits the phrase(s), and the "+" button adds explicitly.
wordInput.addEventListener("input", () => {
  if (!wordInput.value.includes(",")) return;
  const parts = wordInput.value.split(",");
  const tail = parts.pop(); // text after the last comma stays in the field
  for (const p of parts) {
    wordInput.value = p;
    commitInput();
  }
  wordInput.value = tail;
});
$("addWord").addEventListener("pointerdown", (e) => e.preventDefault()); // keep keyboard open
$("addWord").addEventListener("click", () => {
  commitInput();
  wordInput.focus();
});

// ---------- settings ----------
function fill(s) {
  const r = { ...DEFAULTS.region, ...(s.region || {}) };
  $("enabled").checked = s.enabled;
  words = s.words.split("\n").map((w) => w.trim()).filter(Boolean);
  renderChips();
  $("caseSensitive").checked = s.caseSensitive;
  $("blurVideo").checked = s.blurVideo;
  $("intervalMs").value = s.intervalMs;
  $("holdScans").value = s.holdScans;
  $("whitePercent").value = s.whitePercent;
  $("hammingTolerance").value = s.hammingTolerance;
  $("debug").checked = s.debug;
  $("rx").value = r.x; $("ry").value = r.y; $("rw").value = r.w; $("rh").value = r.h;
}
api.storage.sync.get(DEFAULTS, fill);

const num = (id, min, max, fallback) => {
  const v = Number($(id).value);
  return $(id).value !== "" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};

function collect() {
  return {
    enabled: $("enabled").checked,
    words: words.join("\n"),
    caseSensitive: $("caseSensitive").checked,
    blurVideo: $("blurVideo").checked,
    intervalMs: num("intervalMs", 100, 60000, DEFAULTS.intervalMs),
    holdScans: num("holdScans", 1, 10, DEFAULTS.holdScans),
    whitePercent: num("whitePercent", 40, 100, DEFAULTS.whitePercent),
    hammingTolerance: num("hammingTolerance", 0, 99, DEFAULTS.hammingTolerance),
    debug: $("debug").checked,
    region: {
      x: num("rx", 0, 99, DEFAULTS.region.x), y: num("ry", 0, 99, DEFAULTS.region.y),
      w: num("rw", 1, 100, DEFAULTS.region.w), h: num("rh", 1, 100, DEFAULTS.region.h),
    },
  };
}

// ---------- autosave (the popup closes on click-away, so there is no Save button) ----------
let timer = null;
function save(data) {
  api.storage.sync.set(data, () => {
    $("status").textContent = "Sačuvano";
    setTimeout(() => ($("status").textContent = ""), 1200);
  });
}
function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(() => save(collect()), 250);
}
document.addEventListener("input", (e) => {
  if (e.target !== wordInput) scheduleSave();
});
document.addEventListener("change", (e) => {
  // After editing a number, show the clamped value that was actually stored.
  if (e.target.classList.contains("num")) fill(collect());
  scheduleSave();
});

$("reset").addEventListener("click", () => {
  fill(DEFAULTS);
  save({ ...DEFAULTS });
});

// ---------- digits-only number fields (typing, pasting, dropping) ----------
for (const el of document.querySelectorAll("input.num")) {
  // Block non-digit characters as they are typed.
  el.addEventListener("beforeinput", (e) => {
    if (e.data && /\D/.test(e.data)) e.preventDefault();
  });
  // Paste: insert only the digits of the pasted text, respecting maxlength.
  el.addEventListener("paste", (e) => {
    e.preventDefault();
    const digits = (e.clipboardData?.getData("text") ?? "").replace(/\D/g, "");
    if (!digits) return;
    el.setRangeText(digits, el.selectionStart, el.selectionEnd, "end");
    el.value = el.value.slice(0, el.maxLength);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Safety net for anything else (drag & drop, autofill, IME): strip non-digits.
  el.addEventListener("input", () => {
    const clean = el.value.replace(/\D/g, "");
    if (clean !== el.value) el.value = clean;
  });
}
