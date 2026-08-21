// A minimal PDF writer.
//
// Enough of the format to wrap one rendered page image into a real, paginated
// PDF — no library, no build step. A JPEG can be embedded into a PDF verbatim
// (DCTDecode is JPEG), so no compression code is needed here at all.
//
// Why an image rather than typeset text: the canvas renderer in script.js is
// already the single source of truth for what a script looks like, and it is
// what the preview shows. Re-implementing that layout in PDF text operators
// would give selectable text at the cost of two layouts that drift apart, on a
// document where what you saw must be what you sent.

const PT_PER_INCH = 72;

const encoder = new TextEncoder();
const bytes = (s) => encoder.encode(s);

/**
 * Wrap a JPEG into a PDF, split across pages of `pageHeightPt`.
 *
 * A long script renders as one tall image; slicing it over A4 pages keeps it
 * printable instead of producing a single absurdly long page. Every page draws
 * the same image XObject, offset so a different band shows through.
 */
export function jpegToPdf({ jpeg, width, height, dpi = 150, pageHeightPt = 841.89 }) {
  const widthPt = (width / dpi) * PT_PER_INCH;
  const heightPt = (height / dpi) * PT_PER_INCH;
  const pageCount = Math.max(1, Math.ceil(heightPt / pageHeightPt - 0.01));
  // A page shorter than the band it shows would clip; use the image height when
  // it is the only page and fits within a normal sheet.
  const pageHeight = pageCount === 1 ? Math.min(heightPt, pageHeightPt) : pageHeightPt;

  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  const catalogNo = 1;
  const pagesNo = 2;
  const imageNo = 3;

  objects.push(null, null, null); // reserved for catalog, pages, image

  const pageNumbers = [];
  const contentNumbers = [];

  for (let page = 0; page < pageCount; page += 1) {
    // PDF's origin is bottom-left. Placing the image so its top edge sits
    // `page` pages above this page's top exposes the right horizontal band.
    const ty = pageHeight * (1 + page) - heightPt;
    const content =
      `q\n${widthPt.toFixed(2)} 0 0 ${heightPt.toFixed(2)} 0 ${ty.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    const contentNo = add({ dict: `<< /Length ${bytes(content).length} >>`, stream: bytes(content) });
    contentNumbers.push(contentNo);
    pageNumbers.push(
      add({
        dict:
          `<< /Type /Page /Parent ${pagesNo} 0 R ` +
          `/MediaBox [0 0 ${widthPt.toFixed(2)} ${pageHeight.toFixed(2)}] ` +
          `/Resources << /XObject << /Im0 ${imageNo} 0 R >> >> ` +
          `/Contents ${contentNo} 0 R >>`,
      })
    );
  }

  objects[catalogNo - 1] = { dict: `<< /Type /Catalog /Pages ${pagesNo} 0 R >>` };
  objects[pagesNo - 1] = {
    dict:
      `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(" ")}] ` +
      `/Count ${pageNumbers.length} >>`,
  };
  objects[imageNo - 1] = {
    dict:
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${jpeg.length} >>`,
    stream: jpeg,
  };

  // --- serialise, tracking byte offsets for the cross-reference table --------
  const chunks = [];
  let offset = 0;
  const push = (data) => {
    const buf = data instanceof Uint8Array ? data : bytes(data);
    chunks.push(buf);
    offset += buf.length;
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  const offsets = [];
  objects.forEach((obj, index) => {
    offsets[index] = offset;
    push(`${index + 1} 0 obj\n${obj.dict}\n`);
    if (obj.stream) {
      push("stream\n");
      push(obj.stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  });

  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) xref += `${String(at).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}

/** Render a canvas straight to a PDF blob. */
export async function canvasToPdf(canvas, { dpi = 150, quality = 0.92 } = {}) {
  const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  return jpegToPdf({ jpeg, width: canvas.width, height: canvas.height, dpi });
}
