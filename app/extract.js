// Getting text out of a photograph or a PDF.
//
// Three routes, tried in this order:
//   1. a PDF that already carries a text layer  — exact, instant, no OCR
//   2. a PDF without one, rendered to images    — OCR
//   3. a photograph                             — OCR
//
// Both libraries are vendored under vendor/ and loaded on demand, so the app
// still starts in a fraction of a second and still works with no signal.

const PDFJS_URL = new URL("../vendor/pdfjs/pdf.min.mjs", import.meta.url);
const PDFJS_WORKER_URL = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url);
const TESSERACT_URL = new URL("../vendor/tesseract/tesseract.min.js", import.meta.url);
const TESSERACT_DIR = new URL("../vendor/tesseract/", import.meta.url);

/** A page whose text layer is thinner than this is almost certainly a scan. */
const TEXT_LAYER_MIN_CHARS = 60;
const OCR_RENDER_SCALE = 2.2; // ~200dpi, the range Tesseract reads best at
const MAX_PAGES = 5;

// ---------------------------------------------------------------------------
// Library loading
// ---------------------------------------------------------------------------

let pdfjsPromise = null;

function loadPdfjs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    // pdf.js v4 uses Promise.withResolvers, which Safari only shipped in 17.4.
    if (typeof Promise.withResolvers !== "function") {
      Promise.withResolvers = function withResolvers() {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      };
    }
    const pdfjs = await import(PDFJS_URL.href);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL.href;
    return pdfjs;
  })().catch((err) => {
    pdfjsPromise = null;
    throw new Error(`The PDF reader could not be loaded (${err.message}).`);
  });
  return pdfjsPromise;
}

let tesseractPromise = null;

function loadTesseract() {
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const script = document.createElement("script");
    script.src = TESSERACT_URL.href;
    script.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error("not available")));
    script.onerror = () => reject(new Error("script failed to load"));
    document.head.appendChild(script);
    return undefined;
  }).catch((err) => {
    tesseractPromise = null;
    throw new Error(`The text recogniser could not be loaded (${err.message}).`);
  });
  return tesseractPromise;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * Rebuild lines from a PDF text layer.
 *
 * getTextContent returns positioned fragments with no line breaks, so grouping
 * by baseline is what turns "Metformin" "500mg" "o.d." back into one line the
 * prescription parser can read.
 */
function fragmentsToLines(items, tolerance = 3) {
  const rows = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, str: item.str, width: item.width || 0 });
  }

  rows.sort((a, b) => b.y - a.y); // PDF origin is bottom-left

  return rows.map((row) => {
    row.parts.sort((a, b) => a.x - b.x);
    let line = "";
    let cursor = null;
    for (const part of row.parts) {
      if (cursor !== null) {
        const gap = part.x - cursor;
        // A gap wider than roughly a space means the fragments were separated.
        if (gap > 1.2 && !/\s$/.test(line) && !/^\s/.test(part.str)) line += " ";
      }
      line += part.str;
      cursor = part.x + part.width;
    }
    return line.replace(/\s{2,}/g, " ").trim();
  }).filter(Boolean);
}

async function pdfPages(file) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  return { doc, count: Math.min(doc.numPages, MAX_PAGES) };
}

const RENDER_TIMEOUT_MS = 20000;

/**
 * Draw a PDF page onto a canvas.
 *
 * pdf.js drives rendering from requestAnimationFrame, which a browser stops
 * delivering while the page is in the background — so a render started and then
 * backgrounded never settles. The timeout keeps an import from hanging forever
 * in that case; callers decide whether the page was essential.
 */
async function renderPageToCanvas(page, { scale = OCR_RENDER_SCALE } = {}) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const task = page.render({ canvasContext: context, viewport });
  let timer;
  try {
    await Promise.race([
      task.promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Rendering this page timed out — keep the app in the foreground and try again.")),
          RENDER_TIMEOUT_MS
        );
      }),
    ]);
  } catch (err) {
    task.cancel?.();
    throw err;
  } finally {
    clearTimeout(timer);
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// Image preparation
// ---------------------------------------------------------------------------

/**
 * A phone photo is large, often dim and rarely square-on. Downscaling to a
 * sensible width and pushing contrast toward black-on-white measurably improves
 * what Tesseract returns, and costs almost nothing.
 */
export async function prepareImage(source, { maxWidth = 1800 } = {}) {
  const bitmap = source instanceof HTMLCanvasElement ? source : await createImageBitmap(source);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;

  // Mean luminance drives the contrast curve, so a dim photo and a bright scan
  // are both pushed toward the same range rather than one being crushed.
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    total += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }
  const mean = total / (px.length / 4);
  const contrast = 1.6;

  for (let i = 0; i < px.length; i += 4) {
    const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const adjusted = Math.max(0, Math.min(255, (grey - mean) * contrast + 190));
    px[i] = adjusted;
    px[i + 1] = adjusted;
    px[i + 2] = adjusted;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

let workerPromise = null;

async function ocrWorker(onProgress) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const Tesseract = await loadTesseract();
    return Tesseract.createWorker("eng", 1, {
      workerPath: new URL("worker.min.js", TESSERACT_DIR).href,
      corePath: TESSERACT_DIR.href,
      langPath: TESSERACT_DIR.href,
      logger: (m) => {
        if (m.status === "recognizing text" && onProgress) onProgress(m.progress, "Reading text");
        else if (onProgress) onProgress(null, "Preparing the recogniser");
      },
    });
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

/** Free the OCR worker; it holds several megabytes of WebAssembly. */
export async function releaseOcr() {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  if (worker) await worker.terminate().catch(() => {});
}

async function ocrCanvas(canvas, onProgress) {
  const worker = await ocrWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  return { text: data.text || "", confidence: typeof data.confidence === "number" ? data.confidence : null };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function describeSource(file) {
  if (!file) return "unknown";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) return "pdf";
  if (file.type.startsWith("image/")) return "image";
  return "unsupported";
}

/**
 * Read a file into text.
 * `onProgress(fraction|null, label)` is called throughout; fraction may be null
 * when the step has no measurable progress.
 *
 * Resolves to { text, method, confidence, pages, previews }.
 */
export async function extractText(file, { onProgress = () => {} } = {}) {
  const kind = describeSource(file);
  if (kind === "unsupported") {
    throw new Error("That file is neither a PDF nor an image.");
  }

  if (kind === "image") {
    onProgress(null, "Preparing the image");
    const canvas = await prepareImage(file);
    const { text, confidence } = await ocrCanvas(canvas, onProgress);
    return {
      text,
      method: "ocr",
      confidence,
      pages: 1,
      previews: [canvas.toDataURL("image/jpeg", 0.7)],
    };
  }

  onProgress(null, "Opening the PDF");
  const { doc, count } = await pdfPages(file);
  const previews = [];

  try {
    // 1. text layer
    const pageTexts = [];
    for (let n = 1; n <= count; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pageTexts.push(fragmentsToLines(content.items).join("\n"));
    }
    const layerText = pageTexts.join("\n\n").trim();

    if (layerText.replace(/\s/g, "").length >= TEXT_LAYER_MIN_CHARS * count) {
      onProgress(1, "Read from the PDF");
      // The thumbnail is decoration. Never let it fail the import.
      try {
        const first = await doc.getPage(1);
        const rendered = await renderPageToCanvas(first, { scale: 1.4 });
        previews.push(rendered.toDataURL("image/jpeg", 0.6));
      } catch (err) {
        console.warn("[extract] preview skipped", err);
      }
      return { text: layerText, method: "pdf-text", confidence: null, pages: count, previews };
    }

    // 2. scanned PDF — render and OCR. Here the render is the whole job, so a
    // failure is reported rather than swallowed.
    onProgress(null, "This PDF is a scan — reading it with text recognition");
    const parts = [];
    for (let n = 1; n <= count; n += 1) {
      const page = await doc.getPage(n);
      let rendered;
      try {
        rendered = await renderPageToCanvas(page);
      } catch (err) {
        if (parts.length) break; // keep whatever pages did come through
        throw new Error(
          `${err.message} If it keeps failing, photograph the printed page instead — that path does not need the PDF renderer.`
        );
      }
      previews.push(rendered.toDataURL("image/jpeg", 0.6));
      const prepared = await prepareImage(rendered);
      const { text } = await ocrCanvas(prepared, (p, label) =>
        onProgress(p === null ? null : (n - 1 + p) / count, `${label} — page ${n} of ${count}`)
      );
      parts.push(text);
    }
    return { text: parts.join("\n\n"), method: "ocr", confidence: null, pages: count, previews };
  } finally {
    doc.destroy?.();
  }
}
