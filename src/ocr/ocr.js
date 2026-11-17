// Shared OCR engine (Tesseract.js). Loaded by offscreen.html on Chrome and
// directly as a background script on Firefox (which has no offscreen API).
const ocrApi = globalThis.browser ?? chrome;
let ocrWorkerPromise = null;

// Serbian Cyrillic alphabet, upper and lower case.
const OCR_CYRILLIC_ONLY =
  "АБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ" + "абвгдђежзијклљмнњопрстћуфхцчџш";

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = Tesseract.createWorker("srp", 1, { // Serbian, Cyrillic script
      workerPath: ocrApi.runtime.getURL("vendor/worker.min.js"),
      corePath: ocrApi.runtime.getURL("vendor/core"),
      langPath: ocrApi.runtime.getURL("vendor/lang"),
      workerBlobURL: false,
      gzip: true,
    }).then(async (worker) => {
      // The srp model also knows Latin letters and happily reads Cyrillic ones as look-alikes
      // (н->H, в->B, р->P, с->C, у->y, х->x ...). Restricting the output to the Serbian Cyrillic
      // alphabet (plus space) makes it pick the Cyrillic letter instead.
      await worker.setParameters({
        tessedit_char_whitelist: OCR_CYRILLIC_ONLY + " ",
        preserve_interword_spaces: "1",
      });
      return worker;
    }).catch((e) => {
      ocrWorkerPromise = null;
      throw e;
    });
  }
  return ocrWorkerPromise;
}

// Serialise requests: one recognition at a time.
let ocrQueue = Promise.resolve();
function ocrRecognize(image) {
  const run = ocrQueue.then(async () => {
    try {
      const worker = await getOcrWorker();
      const { data } = await worker.recognize(image);
      return { text: data.text || "", confidence: data.confidence };
    } catch (e) {
      return { error: String(e) };
    }
  });
  ocrQueue = run;
  return run;
}
