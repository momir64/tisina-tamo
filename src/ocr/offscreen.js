// Chrome only: answers OCR requests relayed by the service worker.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.type !== "ocr") return;
  ocrRecognize(msg.image).then(sendResponse);
  return true;
});
