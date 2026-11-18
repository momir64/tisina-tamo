// Content script for youtube.com: watches the current video, OCRs frames
// (via the background/offscreen Tesseract worker) and mutes/unmutes the video
// depending on whether the configured text is visible.

const CHANNEL_HANDLE = "ParlamentSrbija"; // hardcoded: https://www.youtube.com/@ParlamentSrbija

// Touch / phone browsers: smaller OCR images (OCR is much slower there) and a compact overlay.
const MOBILE = matchMedia("(pointer: coarse)").matches || /Android|Mobile/i.test(navigator.userAgent);
const MAX_OCR_WIDTH = MOBILE ? 800 : 1280;

const DEFAULTS = {
  enabled: true,
  words: "Александар Вучић\nСрбија побеђује\nВучић", // one word/phrase per line; any match counts
  caseSensitive: false,
  blurVideo: true,     // blur the whole video while we hold the mute
  intervalMs: 300,
  holdScans: 3,        // consecutive scans with the new result needed to change mute state
  region: { x: 0, y: 88, w: 100, h: 12 }, // % of the frame to scan
  hammingTolerance: 1, // max wrong characters (substitutions) allowed when matching a phrase
  whitePercent: 86,    // min(R,G,B) at/above this % of 255 counts as "white text" (86% -> 220)
  debug: false,
};

let settings = { ...DEFAULTS };
let weMuted = false;      // true while the mute was applied by us
let selfChange = false;   // ignore volumechange events we caused
let oppositeStreak = 0;
let lastVideo = null;
let lastFrameCount = 0;   // decoded-frame counter at the previous scan (frozen-picture check)
let overlay = null;

// ---------- settings ----------
function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s, region: { ...DEFAULTS.region, ...(s.region || {}) } };
    if (!settings.debug) removeOverlay();
    const v = getVideo();
    if (v) syncBlur(v); // apply a changed "blur" setting right away
  });
}
chrome.storage.onChanged.addListener(loadSettings);
loadSettings();

// ---------- text helpers ----------
// Serbian Cyrillic -> Latin, so the search text can be typed in either script and
// Cyrillic/Latin look-alike OCR confusions (а/a, е/e, о/o, р/p, с/c...) still match.
const CYR = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "d", е: "e", ж: "z", з: "z", и: "i", ј: "j",
  к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t",
  ћ: "c", у: "u", ф: "f", х: "h", ц: "c", ч: "c", џ: "dz", ш: "s",
};

// Case / script / diacritics folding. Words are separated by single spaces ("spaced" form).
function normalizeSpaced(s, caseSensitive) {
  return (caseSensitive ? s : s.toLowerCase())
    .replace(/[Ѐ-ӿ]/g, (c) => {
      const lat = CYR[c.toLowerCase()];
      if (lat === undefined) return c;
      return c === c.toLowerCase() ? lat : lat.toUpperCase();
    })
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
// Same, with all spaces removed ("stripped" form).
function normalize(s, caseSensitive) {
  return normalizeSpaced(s, caseSensitive).replace(/ /g, "");
}

// True if some window of `hay` has the same length as `n` and differs in at most `tol`
// positions (Hamming distance: substitutions only, no inserted/removed characters).
function hammingContains(hay, n, tol) {
  if (!n || hay.length < n.length) return false;
  tol = Math.min(tol, n.length - 1); // at least one character must still match, or everything would
  for (let i = 0; i + n.length <= hay.length; i++) {
    let d = 0;
    for (let j = 0; j < n.length && d <= tol; j++) if (hay[i + j] !== n[j]) d++;
    if (d <= tol) return true;
  }
  return false;
}

function levenshtein(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// hay / haySpaced: OCR text in stripped and spaced form. tol: allowed Hamming distance.
function wordMatches(hay, haySpaced, needle, cs, tol) {
  const n = normalize(needle, cs);
  if (!n) return false;
  if (hay.includes(n)) return true;
  if (tol > 0) {
    // Substitutions only. Checked on the spaced form too, so a wrongly read space
    // ("srbija pobeduje" -> "srbijaopobeduje") counts as ONE wrong character.
    if (hammingContains(hay, n, tol)) return true;
    if (hammingContains(haySpaced, normalizeSpaced(needle, cs), tol)) return true;
  }
  if (n.length < 5) return false; // too short for fuzzy matching
  const lev = Math.floor(n.length * 0.2);
  for (let len = n.length - 1; len <= n.length + 1; len++) {
    for (let i = 0; i + len <= hay.length; i++) {
      if (levenshtein(n, hay.slice(i, i + len), lev) <= lev) return true;
    }
  }
  return false;
}

// True if ANY line of the word list is found in the OCR text.
function textMatches(ocrText, wordList, caseSensitive, hammingTolerance = 0) {
  const haySpaced = normalizeSpaced(ocrText, caseSensitive);
  const hay = haySpaced.replace(/ /g, "");
  return wordList
    .split("\n")
    .some((w) => wordMatches(hay, haySpaced, w, caseSensitive, hammingTolerance));
}

// ---------- page helpers ----------
function getVideo() {
  return document.querySelector("video.html5-main-video") || document.querySelector("video");
}

function getChannelInfo() {
  const a =
    // desktop (www.youtube.com)
    document.querySelector("ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name a") ||
    document.querySelector("#owner ytd-channel-name a") ||
    document.querySelector("ytd-video-owner-renderer a.yt-simple-endpoint") ||
    // mobile (m.youtube.com)
    document.querySelector('ytm-slim-owner-renderer a[href*="/@"]') ||
    document.querySelector('ytm-slim-owner-renderer a[href*="/channel/"]') ||
    document.querySelector("ytm-slim-owner-renderer a") ||
    // fallbacks that do not depend on the (frequently changing) player layout:
    // schema.org microdata of the watch page, then any link to the channel handle
    document.querySelector('[itemprop="author"] link[itemprop="url"]') ||
    document.querySelector(`a[href*="/@${CHANNEL_HANDLE}" i]`);
  if (!a) return null;
  // <link> elements have no text: the name is in a sibling <link itemprop="name" content="...">
  const name = a.textContent.trim() ||
    a.parentElement?.querySelector('link[itemprop="name"]')?.getAttribute("content") || "";
  return { name, href: a.getAttribute("href") || a.getAttribute("content") || a.href || "" };
}

// The channel block can be unmounted while the player is fullscreen (esp. on mobile),
// so remember the verdict per video id and reuse it while the block is missing.
let channelVerdict = { vid: null, ok: false };
function channelAllowed() {
  const vid = new URLSearchParams(location.search).get("v");
  const info = getChannelInfo();
  if (!info) return channelVerdict.vid === vid ? channelVerdict.ok : false;
  const ok = decodeURIComponent(info.href).toLowerCase().includes("/@" + CHANNEL_HANDLE.toLowerCase());
  channelVerdict = { vid, ok };
  return ok;
}

function isAdShowing() {
  return !!document.querySelector(".html5-video-player.ad-showing");
}

// ---------- muting ----------
// Blur the whole video (CSS filter, done on the GPU) while we hold the mute. The OCR reads the
// decoded frame via canvas, which is not affected by CSS filters.
function applyBlur(video, on) {
  if (!video) return;
  if (on) {
    if (video.dataset.tisinaBlur !== "1") {
      video.dataset.tisinaBlur = "1";
      video.dataset.tisinaPrevFilter = video.style.filter;
    }
    video.style.filter = `blur(${Math.max(5, Math.round(video.clientWidth / 85))}px)`;
  } else if (video.dataset.tisinaBlur === "1") {
    video.style.filter = video.dataset.tisinaPrevFilter || "";
    delete video.dataset.tisinaBlur;
    delete video.dataset.tisinaPrevFilter;
  }
}
function syncBlur(video) {
  applyBlur(video, settings.enabled && settings.blurVideo && weMuted);
}

function setMuted(video, muted) {
  selfChange = true;
  video.muted = muted;
  setTimeout(() => (selfChange = false), 0);
  applyBlur(video, muted && settings.blurVideo);
}

// Remember when the user last interacted, to tell their (un)mute apart from one done by
// YouTube itself (it re-applies its own volume state e.g. after seeks, ads or video changes).
let lastUserInput = 0;
for (const ev of ["pointerdown", "keydown", "touchstart"]) {
  document.addEventListener(ev, () => (lastUserInput = Date.now()), true);
}
let lastWantMute = false;   // what the latest scan wanted (raw, before the consecutive-scans rule)
let remuteTimes = [];       // timestamps, to avoid fighting YouTube in a loop

function watchVideo(video) {
  if (video === lastVideo) return;
  lastVideo = video;
  video.addEventListener("volumechange", () => {
    if (selfChange || !weMuted || video.muted) return;
    const byUser = Date.now() - lastUserInput < 1500;
    const now = Date.now();
    remuteTimes = remuteTimes.filter((t) => now - t < 2000);
    if (byUser || !lastWantMute || remuteTimes.length >= 5) {
      // The user unmuted it, the text is gone anyway, or YouTube keeps fighting us:
      // stop managing this mute.
      weMuted = false;
      return;
    }
    // Unmuted by something else while the text is still visible: mute again right away
    // instead of waiting for several scans.
    remuteTimes.push(now);
    setMuted(video, true);
  });
}

function release(video) {
  if (weMuted && video) setMuted(video, false);
  weMuted = false;
  oppositeStreak = 0;
}

function applyDecision(video, present) {
  const wantMute = present; // hardcoded: mute while the text is visible
  lastWantMute = wantMute;
  // Only change state after N consecutive scans disagree with the current state,
  // so single-frame OCR misses/false hits don't cause flicker.
  if (wantMute === weMuted || (wantMute && video.muted)) {
    oppositeStreak = 0; // nothing to change (or the user already muted it)
    return;
  }
  oppositeStreak++;
  if (oppositeStreak < Math.max(1, settings.holdScans)) return;
  oppositeStreak = 0;
  setMuted(video, wantMute);
  weMuted = wantMute;
}

// ---------- capture + OCR ----------
function captureFrame(video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const r = settings.region;
  const sx = Math.round((vw * r.x) / 100), sy = Math.round((vh * r.y) / 100);
  const sw = Math.max(8, Math.round((vw * r.w) / 100)), sh = Math.max(8, Math.round((vh * r.h) / 100));
  // Downscale big crops (speed), upscale small ones (OCR likes ~30px tall letters).
  const scale = Math.min(2, MAX_OCR_WIDTH / sw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const raw = settings.debug ? canvas.toDataURL("image/jpeg", 0.6) : null;

  // The text is always pure white on an arbitrary background: keep only pixels where
  // ALL channels are near white (coloured backgrounds fail on at least one channel)
  // and render them as black text on a white page, which is what Tesseract expects.
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const t = Math.ceil((settings.whitePercent * 255) / 100);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.min(d[i], d[i + 1], d[i + 2]) >= t ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { image: canvas.toDataURL("image/png"), raw };
}

const OCR_TIMEOUT_MS = 60000; // the first run loads ~10 MB of WASM + language data

function ocr(image) {
  return new Promise((resolve) => {
    // Never wait forever: a hung OCR worker would otherwise freeze the whole scan loop.
    const timer = setTimeout(() => resolve({ error: "OCR timeout" }), OCR_TIMEOUT_MS);
    const done = (r) => {
      clearTimeout(timer);
      resolve(r);
    };
    try {
      chrome.runtime.sendMessage({ type: "ocr", image }, (res) => {
        if (chrome.runtime.lastError) return done({ error: chrome.runtime.lastError.message });
        done(res || { error: "no response" });
      });
    } catch (e) {
      done({ error: String(e) }); // extension reloaded: stale content script
    }
  });
}

// ---------- debug overlay ----------
let overlayText = null, overlayRaw = null, overlayProc = null;

// lines: status text; raw/processed: data URLs of the scanned area (optional)
function showOverlay(lines, raw, processed) {
  if (!settings.debug) return;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.style.cssText =
      `position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:${MOBILE ? 92 : 45}vw;padding:6px 8px;` +
      `background:rgba(0,0,0,.8);color:#0f0;font:${MOBILE ? 10 : 12}px/1.3 monospace;` +
      "pointer-events:none;border-radius:4px";
    const imgCss = `display:block;max-width:100%;max-height:${MOBILE ? 70 : 140}px;margin:4px 0;` +
      "border:1px solid #0f0;background:#444";
    overlayText = document.createElement("div");
    overlayText.style.whiteSpace = "pre-wrap";
    overlayRaw = document.createElement("img");
    overlayProc = document.createElement("img");
    overlayRaw.style.cssText = overlayProc.style.cssText = imgCss;
    overlay.append(overlayText, overlayRaw, overlayProc);
    document.documentElement.appendChild(overlay);
  }
  overlayText.textContent = lines.join("\n");
  for (const [el, src] of [[overlayRaw, raw], [overlayProc, processed]]) {
    if (src) el.src = src;
    el.style.display = src || el.src ? "block" : "none";
  }
}
// Last completed scan, kept so the overlay still shows it while scanning is paused/skipped.
let lastScan = { lines: [], raw: null, processed: null };
function showSkip(status) {
  const prev = lastScan.lines.length ? ["— poslednje skeniranje —", ...lastScan.lines] : [];
  showOverlay([status, ...prev], lastScan.raw, lastScan.processed);
}
function removeOverlay() {
  overlay?.remove();
  overlay = overlayText = overlayRaw = overlayProc = null;
}

// ---------- main loop ----------
async function tick() {
  const video = getVideo();
  try {
    if (video) syncBlur(video); // also clears the blur if the user unmuted manually etc.
    // With the master switch off nothing is muted, but if the diagnostic view is on we
    // still scan and show it (diagnostics only).
    const diagnosticsOnly = !settings.enabled && settings.debug;
    if (!video || !(settings.enabled || diagnosticsOnly) || !settings.words.trim() ||
        !location.pathname.startsWith("/watch")) {
      release(video);
      removeOverlay();
      return;
    }
    if (!settings.enabled) release(video); // hand the sound back if we had muted it
    watchVideo(video);

    if (!channelAllowed()) {
      release(video);
      showOverlay(["kanal se ne poklapa: " + (getChannelInfo()?.name ?? "?")]);
      return;
    }
    // In diagnostic mode say why nothing is scanned instead of silently doing nothing.
    const skip = video.paused ? "video je pauziran" : video.ended ? "video je završen"
      : document.hidden ? "kartica nije vidljiva" : isAdShowing() ? "reklama" : null;
    if (skip) {
      oppositeStreak = 0; // a gap in scanning breaks the "consecutive scans" run
      showSkip(`preskočeno: ${skip}`);
      return;
    }

    // Browsers stop decoding video frames for tabs/windows that are in the background or
    // covered, while the sound keeps playing. The canvas then returns a stale or black frame,
    // which would look like "text gone" and wrongly unmute. If no new frame was decoded since
    // the previous scan, don't trust the image: keep the current mute state.
    const q = video.getVideoPlaybackQuality?.();
    const frames = q ? q.totalVideoFrames : 0;
    const frozen = frames > 0 && frames === lastFrameCount;
    lastFrameCount = frames;
    if (frozen) {
      oppositeStreak = 0;
      showSkip("preskočeno: slika je zamrznuta (kartica u pozadini?)");
      return;
    }

    let frame;
    try {
      frame = captureFrame(video);
    } catch (e) {
      showSkip("greška pri snimanju kadra: " + e);
      return;
    }
    if (!frame) {
      showSkip("video još nema dimenzije (nije učitan)");
      return;
    }
    // Only on the very first scan (nothing to show yet) display the crop right away; after that
    // keep the previous scan's details on screen until the new result replaces them.
    if (!lastScan.lines.length) showOverlay(["skeniranje…"], frame.raw, frame.image);
    const res = await ocr(frame.image);
    if (res.error) {
      showOverlay(["OCR greška: " + res.error], frame.raw, frame.image);
      return;
    }
    const present = textMatches(res.text, settings.words, settings.caseSensitive, settings.hammingTolerance);
    if (settings.enabled) applyDecision(video, present);
    const lines = [
      ...(settings.enabled ? [] : ["Dodatak je isključen. Dijagnostika radi, ali zvuk se neće menjati."]),
      `kanal: ${getChannelInfo()?.name}`,
      `tekst prisutan: ${present ? "da" : "ne"}`,
      `zvuk: ${video.muted ? "utišan" : "uključen"}  (promena za: ${oppositeStreak}/${Math.max(1, settings.holdScans)} skeniranja)`,
      `OCR: ${res.text.trim().replace(/\s+/g, " ").slice(0, 200)}`,
    ];
    lastScan = { lines, raw: frame.raw, processed: frame.image };
    showOverlay(lines, frame.raw, frame.image);
  } catch (e) {
    console.warn("[Tišina tamo]", e);
  } finally {
    setTimeout(tick, Math.max(100, settings.intervalMs));
  }
}
tick();
