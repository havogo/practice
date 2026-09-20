// Signing on the device.
//
// A photograph of a signature is awkward to get right — paper shadows, a grey
// cast, an off-square crop. Drawing it with a finger takes ten seconds and
// produces a clean transparent PNG that sits properly on the letterhead.

import { html, mount } from "./ui.js";
import { icon } from "./icons.js";

const WIDTH = 900;   // stored resolution; drawn at whatever size the sheet gives
const HEIGHT = 300;

/**
 * Open a signing pad. Resolves to a transparent PNG data URL, or null.
 *
 * `initial` pre-loads an existing signature so it can be seen before replacing.
 */
export async function captureSignature() {
  const { sheet } = await import("./components.js");

  return sheet({
    title: "Sign here",
    body: html`
      <p class="small muted" style="margin-bottom:10px">
        Sign with your finger, or an Apple Pencil. Take your time — the box is bigger than it
        looks and the line is smoothed.
      </p>
      <div class="sigpad">
        <canvas id="sig-canvas" class="sigpad__canvas"></canvas>
        <div class="sigpad__baseline"></div>
        <span class="sigpad__hint" id="sig-hint">Sign above the line</span>
      </div>
      <div class="btn-row btn-row--split" style="margin-top:12px">
        <button class="btn btn--outline" data-sig="clear">${icon("close", { size: 16 })} Clear</button>
        <button class="btn btn--primary" data-sig="save" disabled>Use this signature</button>
      </div>
      <p class="small muted" style="margin-top:12px">
        Rotate the phone sideways for a wider box.
      </p>
    `,
    onMount(root, close) {
      const canvas = root.querySelector("#sig-canvas");
      const hint = root.querySelector("#sig-hint");
      const saveButton = root.querySelector("[data-sig='save']");
      const ctx = canvas.getContext("2d");

      // Strokes are kept as points rather than only painted, so the pad can be
      // resized (rotating the phone) without losing what has been drawn.
      let strokes = [];
      let current = null;

      const fit = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        redraw();
      };

      function redraw() {
        const rect = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.strokeStyle = "#101010";
        ctx.lineWidth = 2.6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const stroke of strokes) drawStroke(stroke, rect);
      }

      /** Quadratic midpoints turn a jittery finger path into a smooth line. */
      function drawStroke(stroke, rect) {
        const pts = stroke.map(([nx, ny]) => [nx * rect.width, ny * rect.height]);
        if (pts.length === 1) {
          ctx.beginPath();
          ctx.arc(pts[0][0], pts[0][1], 1.4, 0, Math.PI * 2);
          ctx.fillStyle = "#101010";
          ctx.fill();
          return;
        }
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i += 1) {
          const [x, y] = pts[i];
          const [nx, ny] = pts[i + 1];
          ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last[0], last[1]);
        ctx.stroke();
      }

      // Points are stored 0..1 so they survive a resize.
      const at = (event) => {
        const rect = canvas.getBoundingClientRect();
        return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
      };

      const start = (event) => {
        event.preventDefault();
        canvas.setPointerCapture?.(event.pointerId);
        current = [at(event)];
        strokes.push(current);
        hint.style.opacity = "0";
        saveButton.disabled = false;
        redraw();
      };
      const move = (event) => {
        if (!current) return;
        event.preventDefault();
        // Coalesced events keep a fast stroke from becoming a polygon — but an
        // empty array is still truthy, and falling through to it would drop
        // every point between touch-down and touch-up.
        const coalesced = event.getCoalescedEvents?.();
        const points = coalesced && coalesced.length ? coalesced : [event];
        for (const e of points) current.push(at(e));
        redraw();
      };
      const end = () => { current = null; };

      canvas.addEventListener("pointerdown", start);
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", end);
      canvas.addEventListener("pointercancel", end);
      canvas.addEventListener("pointerleave", end);

      root.querySelector("[data-sig='clear']").addEventListener("click", () => {
        strokes = [];
        current = null;
        hint.style.opacity = "";
        saveButton.disabled = true;
        redraw();
      });

      saveButton.addEventListener("click", () => close(toDataUrl(strokes)));

      const onResize = () => fit();
      window.addEventListener("resize", onResize);
      requestAnimationFrame(fit);
      setTimeout(fit, 120); // the sheet animates in; measure once it has settled
    },
  });
}

/**
 * Render the strokes at a fixed resolution, cropped to the ink with a little
 * padding, on transparency — so it drops onto the letterhead without a box.
 */
function toDataUrl(strokes) {
  if (!strokes.length) return null;

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  // A signature that is all one horizontal flourish still needs some height.
  const pad = 0.04;
  minX = Math.max(0, minX - pad); maxX = Math.min(1, maxX + pad);
  minY = Math.max(0, minY - pad * 2); maxY = Math.min(1, maxY + pad * 2);
  const spanX = Math.max(maxX - minX, 0.05);
  const spanY = Math.max(maxY - minY, 0.05);

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = Math.max(1, Math.round(WIDTH * (spanY / spanX)));
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#101010";
  // Relative to height, not width. The letterhead scales a signature to a fixed
  // height, so a width-relative stroke comes out hairline on a tall signature
  // and heavy on a wide one; this keeps the printed weight the same either way.
  ctx.lineWidth = Math.max(4, canvas.height * 0.022);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const px = (x) => ((x - minX) / spanX) * canvas.width;
  const py = (y) => ((y - minY) / spanY) * canvas.height;

  for (const stroke of strokes) {
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(px(stroke[0][0]), py(stroke[0][1]), ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#101010";
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(px(stroke[0][0]), py(stroke[0][1]));
    for (let i = 1; i < stroke.length - 1; i += 1) {
      const x = px(stroke[i][0]);
      const y = py(stroke[i][1]);
      const nx = px(stroke[i + 1][0]);
      const ny = py(stroke[i + 1][1]);
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    const last = stroke[stroke.length - 1];
    ctx.lineTo(px(last[0]), py(last[1]));
    ctx.stroke();
  }

  void HEIGHT;
  return canvas.toDataURL("image/png");
}
