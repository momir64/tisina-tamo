// Chrome: service worker that relays OCR requests to an offscreen document.
// Firefox: background page (scripts: tesseract + src/ocr/ocr.js + this file) that runs OCR itself.
const api = globalThis.browser ?? chrome;
const USE_OFFSCREEN = !!api.offscreen;

// ---------- toolbar icon follows the "enabled" setting ----------
// icons/iconNN.png = on, icons/iconNN_off.png = off (sources in icons/source/*.svg)
function setIcon(enabled) {
  const suffix = enabled ? "" : "_off";
  const path = {};
  for (const n of [16, 32, 48, 128]) path[n] = `icons/icon${n}${suffix}.png`;
  api.action.setIcon({ path });
}
function syncIcon() {
  api.storage.sync.get({ enabled: true }, (s) => setIcon(s.enabled));
}
api.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.enabled) setIcon(changes.enabled.newValue);
});
// setIcon is not persisted by the browser, so re-apply on every start of the worker.
api.runtime.onStartup.addListener(syncIcon);
api.runtime.onInstalled.addListener(syncIcon);
syncIcon();

let creating = null;
async function ensureOffscreen() {
  const url = api.runtime.getURL("src/ocr/offscreen.html");
  const existing = await api.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url],
  });
  if (existing.length) return;
  if (!creating) {
    creating = api.offscreen
      .createDocument({
        url: "src/ocr/offscreen.html",
        reasons: ["WORKERS"],
        justification: "Run OCR (Tesseract.js web worker) on video frames",
      })
      .finally(() => (creating = null));
  }
  await creating;
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "ocr") return; // only handle content-script requests
  (async () => {
    try {
      if (USE_OFFSCREEN) {
        await ensureOffscreen();
        sendResponse(
          await api.runtime.sendMessage({ target: "offscreen", type: "ocr", image: msg.image })
        );
      } else {
        sendResponse(await ocrRecognize(msg.image)); // defined in ocr.js (Firefox)
      }
    } catch (e) {
      sendResponse({ error: String(e) });
    }
  })();
  return true; // async response
});
