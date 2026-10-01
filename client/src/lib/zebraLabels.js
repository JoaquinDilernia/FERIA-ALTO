// Motor de etiquetas para la Zebra ZD421, portado de "Etiquetas Feria Zebra.html"
// (la herramienta suelta que se usaba antes). El diseño y el ZPL son los mismos;
// lo único que cambia es que en vez de leer los controles de la página cada
// función recibe `cfg`:
//   { ori, dpi, dark, shiftX, shiftY, pf }
// ori: 'h' (80×40), 'v' (40×80), 's' (60×20) o 'c<ancho>x<alto>' (agregado a mano).
// dpi: puntos por mm (8 = 203 dpi, 12 = 300 dpi). pf: qué campos van impresos.
// Cada etiqueta `it` es { sku, modelo, color, estado, precio, transf, qty }.
import JsBarcode from 'jsbarcode';
import './zebraLabels.css';

export const BUILTIN_SIZES = [{ v: 'h', w: 80, h: 40 }, { v: 'v', w: 40, h: 80 }, { v: 's', w: 60, h: 20 }];
export const DEFAULT_CUSTOM_SIZES = [{ w: 50, h: 25 }];
export const DEFAULT_FIELDS = { sku: true, barcode: true, modelo: true, color: false, estado: false, precio: true, transf: true };
export const DEFAULT_CONFIG = { ori: 'h', dpi: 8, dark: 15, shifts: {}, pf: DEFAULT_FIELDS, mode: 'zpl', customSizes: DEFAULT_CUSTOM_SIZES };

export const customSizeId = s => `c${s.w}x${s.h}`;
export const fmtMM = n => String(n).replace('.', ',');

export function dimsMM(ori) {
  if (ori.startsWith('c')) { const m = ori.match(/^c([\d.]+)x([\d.]+)$/); if (m) return [+m[1], +m[2]]; }
  return ori === 'v' ? [40, 80] : ori === 's' ? [60, 20] : [80, 40];
}
const isCustom = cfg => cfg.ori.startsWith('c');

const fmt = n => '$ ' + Math.round(n).toLocaleString('es-AR');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const txt = s => String(s).replace(/[\^~\\]/g, ' ');
const norm = s => String(s ?? '').trim().toUpperCase();
const header = (W, H, shX, shY, cfg) =>
  `^XA^CI28^PW${W}^LL${H}^LH0,0^LS${-shX}^LT${Math.max(-120, Math.min(120, shY))}^MD${(+cfg.dark || 15) - 15}\n`;

function lineTop(it, pf) { return [pf.modelo && it.modelo, pf.color && it.color].filter(Boolean).join(' · '); }

function drawBarcode(svg, value) {
  try { JsBarcode(svg, value, { format: 'CODE128B', width: 1, height: 40, displayValue: false, margin: 0 }); } catch { /* código inválido: queda vacío */ }
  svg.setAttribute('preserveAspectRatio', 'none');
}

/* ---------- Diseño automático para cualquier tamaño ----------
   Devuelve bloques en mm; lo usan la vista previa/driver (HTML) y el ZPL, así salen iguales. */
function genLayout(it, W, H, cfg) {
  const PF = cfg.pf;
  const top = lineTop(it, PF), est = PF.estado && it.estado ? String(it.estado).toUpperCase() : '';
  const pr = PF.precio && isFinite(it.precio) && it.precio > 0, tr = PF.transf && isFinite(it.transf) && it.transf > 0;
  const bc = PF.sku && PF.barcode !== false && !!it.sku, skuT = PF.sku && PF.barcode === false && !!it.sku;
  const p1 = pr ? fmt(it.precio) : '', p2 = tr ? fmt(it.transf) : '';
  const padV = Math.max(0.6, H * 0.04), padH = Math.max(1.5, W * 0.035);
  const Wc = W - 2 * padH, Hc = H - 2 * padV;
  const portrait = H > W * 1.2;               // etiqueta vertical: "TRANSFERENCIA" arriba del precio
  const cw = 0.58, cwL = 0.66;              // ancho promedio de carácter (em) para precios / rótulo
  const mods = bc ? 11 * it.sku.length + 35 : 0;
  // arma el diseño en modo "fila" (precios lado a lado) o "columna" (uno abajo del otro)
  const build = row => {
    const LAB = row || Wc < 45 ? 'TRANSF.' : 'TRANSFERENCIA';
    const wTop = top ? 1 : 0, wEst = est ? 0.72 : 0, wBar = bc ? (row ? 2.3 : 2.6) : 0, wSku = bc ? 0.72 : 0, wSkuT = skuT ? 0.85 : 0;
    const nPriceRows = row ? ((pr || tr) ? 1 : 0) : ((pr ? 1 : 0) + (tr ? 1 : 0));
    const wPr = nPriceRows * 2.0, wLab = (!row && portrait && tr) ? 0.55 : 0;
    const u = Hc * 0.86 / Math.max(1, wTop + wEst + wPr + wLab + wBar + wSku + wSkuT);
    let fTop = Math.min(wTop * u, 5), fEst = wEst * u, fP = 2.0 * u, fBar = wBar * u, fSku = Math.min(wSku * u, 3.4), fSkuT = Math.min(wSkuT * u, 3.6);
    if (!bc && !top && !skuT) fP = Math.min(fP, H * 0.35);
    const lineW = f => {
      if (row) return (pr ? p1.length * cw * f : 0) + (tr ? LAB.length * cwL * f * 0.45 + 1 + p2.length * cw * f : 0) + (pr && tr ? 2.5 : 0);
      const a = pr ? p1.length * cw * f : 0, b = tr ? (portrait ? p2.length * cw * f : LAB.length * cwL * f * 0.42 + 1.2 + p2.length * cw * f) : 0;
      return Math.max(a, b);
    };
    if (pr || tr) { const lw = lineW(fP); if (lw > Wc) fP *= Wc / lw; }
    if (top) { const tw = top.length * 0.55 * fTop; if (tw > Wc && !portrait) fTop = Math.max(1.8, fTop * Wc / tw); }
    const fLab = portrait ? Math.min(2.8, Math.max(1.6, wLab * u)) : Math.max(1.4, Math.min(2.8, fP * (row ? 0.45 : 0.42)));
    // si sobra lugar (sin código de barras) el modelo y el SKU también crecen un poco
    if (!bc) { fTop = Math.min(fTop * 1.15, fP * 0.7, top ? Wc / (top.length * 0.55) : 99); fSkuT = Math.min(fSkuT * 1.1, fP * 0.6); }
    return { row, LAB, fTop, fEst, fP, fLab, fBar, fSku, fSkuT };
  };
  let R = build((H / W) <= 0.4);
  if (R.row && !bc && pr && tr) { const S = build(false); if (S.fP > R.fP * 1.05) R = S; }   // sin código: si apilados salen más grandes, apilar
  const dpm = +cfg.dpi;
  let mw = 0;
  if (bc) { const maxW = W - 2.5; const dots = Math.max(1, Math.min(4 * dpm / 8, Math.floor(maxW / mods * dpm))); mw = dots / dpm; }
  return { W, H, padV, padH, Wc, Hc, portrait, top, est, pr, tr, bc, skuT, p1, p2, ...R, mw, mods, sku: it.sku, qty: it.qty };
}

function labelGen(it, cfg, forPrint) {
  const [W, H] = dimsMM(cfg.ori); const L = genLayout(it, W, H, cfg);
  const sh = forPrint ? (+cfg.shiftX || 0) : 0, sy = forPrint ? (+cfg.shiftY || 0) : 0;
  const d = document.createElement('div'); d.className = 'plbl' + (forPrint ? '' : ' lbl');
  d.style.cssText = `width:${W}mm;height:${H}mm;padding:${L.padV}mm ${L.padH}mm`;
  const ln = `border-top:0.3mm solid #000;padding-top:${Math.min(0.8, L.fP * 0.12)}mm`;
  let h = `<div class="pin" style="transform:translate(${sh}mm,${sy}mm)">`;
  if (L.top) h += `<div class="pm" style="font-size:${L.fTop}mm;${L.portrait ? '' : 'white-space:nowrap'}">${esc(L.top)}</div>`;
  if (L.est) h += `<div class="pe" style="font-size:${L.fEst}mm">${esc(L.est)}</div>`;
  const labSpan = `<span style="font-size:${L.fLab}mm;font-weight:700;letter-spacing:.3px;vertical-align:middle">${L.LAB}</span>`;
  if (L.row && (L.pr || L.tr)) {
    h += `<div style="display:flex;align-items:center;justify-content:center;gap:${Math.max(1.2, L.fP * 0.35)}mm;white-space:nowrap">`;
    if (L.pr) h += `<span class="pp" style="font-size:${L.fP}mm">${L.p1}</span>`;
    if (L.pr && L.tr) h += `<span style="display:inline-block;width:0.3mm;height:${L.fP * 0.8}mm;background:#000"></span>`;
    if (L.tr) h += `<span class="pp" style="font-size:${L.fP}mm">${labSpan} ${L.p2}</span>`;
    h += '</div>';
  } else {
    if (L.pr) h += `<div class="pp" style="font-size:${L.fP}mm">${L.p1}</div>`;
    if (L.tr) h += L.portrait
      ? `<div style="text-align:center;${L.pr ? ln : ''}"><div class="pe" style="font-size:${L.fLab}mm;font-weight:700">${L.LAB}</div><div class="pp" style="font-size:${L.fP}mm">${L.p2}</div></div>`
      : `<div class="pp" style="font-size:${L.fP}mm;${L.pr ? ln : ''}">${labSpan} ${L.p2}</div>`;
  }
  if (L.bc) h += `<div style="display:flex;flex-direction:column;align-items:center"><svg></svg><div class="ps" style="font-size:${L.fSku}mm;margin-top:0.3mm">${esc(L.sku)}</div></div>`;
  if (L.skuT) h += `<div class="ps" style="font-size:${L.fSkuT}mm;font-weight:700">${esc(L.sku)}</div>`;
  h += '</div>';
  if (!forPrint) h += `<span class="qty">×${it.qty}</span>`;
  d.innerHTML = h;
  if (L.bc) {
    const svg = d.querySelector('svg');
    drawBarcode(svg, L.sku);
    svg.style.width = (L.mods * L.mw) + 'mm'; svg.style.height = L.fBar + 'mm';
  }
  return d;
}

function zplGen(it, cfg) {
  const dpm = +cfg.dpi, [Wm, Hm] = dimsMM(cfg.ori), L = genLayout(it, Wm, Hm, cfg);
  const D = v => Math.round(v * dpm), W = D(Wm), H = D(Hm);
  const shX = D(+cfg.shiftX || 0), shY = D(+cfg.shiftY || 0);
  const mx = D(L.padH), bw = W - 2 * mx, blocks = [];
  const A = (f) => `^A0N,${D(f)},${Math.round(D(f) * 0.93)}`;
  const tw = (s, f, k) => s.length * D(f) * 0.93 * k;              // ancho estimado fuente 0
  if (L.top) { const lines = L.portrait ? 2 : 1; blocks.push({ h: D(L.fTop) * lines + (lines - 1) * D(0.4), z: y => `^FO${mx},${y}${A(L.fTop)}^FB${bw},${lines},${D(0.4)},C^FD${txt(L.top)}^FS\n` }); }
  if (L.est) blocks.push({ h: D(L.fEst), z: y => `^FO${mx},${y}${A(L.fEst)}^FB${bw},1,0,C^FD${txt(L.est)}^FS\n` });
  const inline = (y, parts) => { // parts: [{s,f,k,dy}] centrados juntos en una fila
    const gap = D(Math.max(1, L.fP * 0.3)); const ws = parts.map(p => p.w != null ? p.w : tw(p.s, p.f, p.k));
    const tot = ws.reduce((a, b) => a + b, 0) + gap * (parts.length - 1); let x = Math.max(mx, Math.round((W - tot) / 2)); let z = '';
    parts.forEach((p, i) => { if (p.bar) z += `^FO${Math.round(x + ws[i] / 2)},${y + D(L.fP * 0.1)}^GB2,${D(L.fP * 0.8)},2^FS\n`; else z += `^FO${Math.round(x)},${y + (p.dy || 0)}${A(p.f)}^FD${txt(p.s)}^FS\n`; x += ws[i] + gap; });
    return { z, tot, x0: Math.max(mx, Math.round((W - tot) / 2)) };
  };
  const labDy = D(L.fP) - D(L.fLab) - D(L.fP * 0.12);
  if (L.row && (L.pr || L.tr)) {
    const parts = []; if (L.pr) parts.push({ s: L.p1, f: L.fP, k: .55 }); if (L.pr && L.tr) parts.push({ bar: 1, w: 2 });
    if (L.tr) { parts.push({ s: L.LAB, f: L.fLab, k: .62, dy: labDy }); parts.push({ s: L.p2, f: L.fP, k: .55 }); }
    blocks.push({ h: D(L.fP), z: y => inline(y, parts).z });
  } else {
    if (L.pr) blocks.push({ h: D(L.fP), z: y => `^FO${mx},${y}${A(L.fP)}^FB${bw},1,0,C^FD${txt(L.p1)}^FS\n` });
    if (L.tr) {
      if (L.portrait) blocks.push({ h: D(L.fLab) + D(0.5) + D(L.fP), z: y => (L.pr ? `^FO${mx + D(4)},${Math.max(0, y - D(0.8))}^GB${bw - D(8)},2,2^FS\n` : '') + `^FO${mx},${y}${A(L.fLab)}^FB${bw},1,0,C^FD${L.LAB}^FS\n^FO${mx},${y + D(L.fLab) + D(0.5)}${A(L.fP)}^FB${bw},1,0,C^FD${txt(L.p2)}^FS\n` });
      else blocks.push({ h: D(L.fP), z: y => { const r = inline(y, [{ s: L.LAB, f: L.fLab, k: .62, dy: labDy }, { s: L.p2, f: L.fP, k: .55 }]); return (L.pr ? `^FO${r.x0},${Math.max(0, y - D(0.8))}^GB${Math.round(r.tot)},2,2^FS\n` : '') + r.z; } });
    }
  }
  if (L.bc) {
    const md = Math.max(1, Math.round(L.mw * dpm)), bx = Math.max(0, Math.round((W - L.mods * md) / 2)), bh = D(L.fBar);
    blocks.push({ h: bh + D(0.3) + D(L.fSku), z: y => `^FO${bx},${y}^BY${md}^BCN,${bh},N,N,N^FD>:${txt(L.sku)}^FS\n^FO${mx},${y + bh + D(0.3)}${A(L.fSku)}^FB${bw},1,0,C^FD${txt(L.sku)}^FS\n` });
  }
  if (L.skuT) blocks.push({ h: D(L.fSkuT), z: y => `^FO${mx},${y}${A(L.fSkuT)}^FB${bw},1,0,C^FD${txt(L.sku)}^FS\n` });
  const used = blocks.reduce((a, b) => a + b.h, 0), g = Math.max(0, Math.floor((H - 2 * D(L.padV) - used) / (blocks.length + 1)));
  let z = header(W, H, shX, shY, cfg);
  let y = D(L.padV) + g; for (const b of blocks) { z += b.z(y); y += b.h + g; }
  return z + `^PQ${it.qty},0,1,Y^XZ\n`;
}

/* Etiqueta chica 60 × 20 mm: modelo arriba, precios en una fila, código abajo */
function labelSmall(it, cfg, forPrint) {
  const PF = cfg.pf;
  const sh = forPrint ? (+cfg.shiftX || 0) : 0, sy = forPrint ? (+cfg.shiftY || 0) : 0;
  const top = [lineTop(it, PF), PF.estado && it.estado ? String(it.estado).toUpperCase() : ''].filter(Boolean).join(' · ');
  const pr = PF.precio, tr = PF.transf && isFinite(it.transf) && it.transf > 0, bc = PF.sku && it.sku, two = pr && tr;
  const d = document.createElement('div'); d.className = 'plbl' + (forPrint ? '' : ' lbl');
  d.style.cssText = 'width:60mm;height:20mm;padding:0.6mm 1.5mm';
  const fP = two ? (bc ? 3.9 : 5.6) : (bc ? 4.8 : 8);
  let h = `<div class="pin" style="transform:translate(${sh}mm,${sy}mm)">`;
  if (top) h += `<div class="pm" style="font-size:2.5mm;white-space:nowrap">${esc(top)}</div>`;
  if (pr || tr) {
    h += `<div style="display:flex;align-items:baseline;justify-content:center;gap:2.2mm;white-space:nowrap">`;
    if (pr) h += `<span class="pp" style="font-size:${fP}mm">${fmt(it.precio)}</span>`;
    if (two) h += `<span style="display:inline-block;width:0.3mm;height:${fP * .8}mm;background:#000;align-self:center"></span>`;
    if (tr) h += `<span class="pp" style="font-size:${fP}mm"><span style="font-size:${Math.min(2.1, fP * .45)}mm;font-weight:700;vertical-align:middle">TRANSF.</span> ${fmt(it.transf)}</span>`;
    h += '</div>';
  }
  if (bc) h += `<div style="display:flex;flex-direction:column;align-items:center"><svg></svg><div class="ps" style="font-size:2mm;margin-top:0.4mm">${esc(it.sku)}</div></div>`;
  h += '</div>';
  if (!forPrint) h += `<span class="qty">×${it.qty}</span>`;
  d.innerHTML = h;
  if (bc) {
    const svg = d.querySelector('svg');
    drawBarcode(svg, it.sku);
    const mods = 11 * it.sku.length + 35, mw = Math.min(0.375, 56 / mods);
    svg.style.width = (mods * mw) + 'mm'; svg.style.height = ((top ? 1 : 0) + (pr || tr ? 1 : 0) >= 2 ? 7.4 : ((top || pr || tr) ? 10 : 13)) + 'mm';
  }
  return d;
}

function zplSmall(it, cfg) {
  const PF = cfg.pf;
  const dpm = +cfg.dpi, k = dpm / 8, q = v => Math.round(v * k);
  const W = Math.round(60 * dpm), H = Math.round(20 * dpm);
  const shX = Math.round((+cfg.shiftX || 0) * dpm), shY = Math.round((+cfg.shiftY || 0) * dpm);
  const top = txt([lineTop(it, PF), PF.estado && it.estado ? String(it.estado).toUpperCase() : ''].filter(Boolean).join(' · '));
  const pr = PF.precio, tr = PF.transf && isFinite(it.transf) && it.transf > 0, sku = PF.sku && it.sku ? txt(it.sku) : '', two = pr && tr;
  const m = q(10), bw = W - 2 * m, blocks = [];
  if (top) blocks.push({ h: q(20), z: y => `^FO${m},${y}^A0N,${q(20)},${q(18)}^FB${bw},1,0,C^FD${top}^FS\n` });
  if (pr || tr) {
    const hP = two ? (sku ? 31 : 46) : (sku ? 38 : 64), wch = q(hP) * .93 * .55, hL = q(15), wL = 7 * q(14) * .62, gap = q(14);
    const p1 = pr ? txt(fmt(it.precio)) : '', p2 = tr ? txt(fmt(it.transf)) : '';
    const w1 = p1.length * wch, w2 = tr ? wL + q(6) + p2.length * wch : 0, tot = w1 + w2 + (two ? gap : 0);
    const x0 = Math.max(m, Math.round((W - tot) / 2));
    blocks.push({
      h: q(hP), z: y => {
        let z = '', x = x0;
        if (pr) { z += `^FO${Math.round(x)},${y}^A0N,${q(hP)},${q(Math.round(hP * .93))}^FD${p1}^FS\n`; x += w1; }
        if (two) { z += `^FO${Math.round(x + gap / 2)},${y}^GB2,${q(hP)},2^FS\n`; x += gap; }
        if (tr) { z += `^FO${Math.round(x)},${y + q(hP) - hL - q(Math.round(hP * .12))}^A0N,${hL},${q(14)}^FDTRANSF.^FS\n`; x += wL + q(6); z += `^FO${Math.round(x)},${y}^A0N,${q(hP)},${q(Math.round(hP * .93))}^FD${p2}^FS\n`; }
        return z;
      },
    });
  }
  if (sku) {
    const mod128 = 11 * sku.length + 35, byD = Math.max(1, Math.round((mod128 * 3 * k <= bw ? 3 : mod128 * 2 * k <= bw ? 2 : 1) * k)), bx = Math.max(m, Math.round((W - mod128 * byD) / 2));
    const bh = blocks.length >= 2 ? q(62) : (blocks.length ? q(80) : q(104));
    blocks.push({ h: bh + q(18), z: y => `^FO${bx},${y}^BY${byD}^BCN,${bh},N,N,N^FD>:${sku}^FS\n^FO${m},${y + bh + q(2)}^A0N,${q(16)},${q(15)}^FB${bw},1,0,C^FD${sku}^FS\n` });
  }
  const used = blocks.reduce((a, b) => a + b.h, 0), g = Math.max(0, Math.floor((H - used) / (blocks.length + 1)));
  let z = header(W, H, shX, shY, cfg);
  let y = g; for (const b of blocks) { z += b.z(y); y += b.h + g; }
  return z + `^PQ${it.qty},0,1,Y^XZ\n`;
}

// Etiqueta (vista previa o impresión por driver) como elemento del DOM.
export function labelEl(it, cfg, forPrint) {
  const PF = cfg.pf;
  if (isCustom(cfg) || PF.barcode === false) return labelGen(it, cfg, forPrint);
  if (cfg.ori === 's') return labelSmall(it, cfg, forPrint);
  const vert = cfg.ori === 'v';
  const W = vert ? 40 : 80, H = vert ? 80 : 40;
  const sh = forPrint ? (+cfg.shiftX || 0) : 0, sy = forPrint ? (+cfg.shiftY || 0) : 0;
  const top = lineTop(it, PF), est = PF.estado && it.estado, pr = PF.precio, tr = PF.transf && isFinite(it.transf) && it.transf > 0, bc = PF.sku && it.sku;
  const crowd = (top ? 1 : 0) + (est ? 1 : 0) + (pr ? 1 : 0) + (tr ? 1 : 0) + (bc ? 1 : 0);
  const two = pr && tr;
  const d = document.createElement('div'); d.className = 'plbl' + (forPrint ? '' : ' lbl');
  d.style.cssText = `width:${W}mm;height:${H}mm;padding:${vert ? '4mm 2mm' : '1.5mm 3mm'}`;
  let fTop = vert ? 3.6 : (crowd >= 4 ? 3.8 : 4.4), fPr = vert ? (bc ? 8.5 : 11) : (bc ? (crowd >= 4 ? 9.5 : 11) : 15);
  if (two) { fPr = vert ? (crowd >= 5 ? 6 : 6.5) : (crowd >= 5 ? 6.2 : (bc ? 7.2 : 9.5)); if (!vert && crowd >= 5) fTop = 3.6; }
  let h = `<div class="pin" style="transform:translate(${sh}mm,${sy}mm)">`;
  if (top) h += `<div class="pm" style="font-size:${fTop}mm;${vert ? 'max-height:8.5mm' : 'white-space:nowrap'}">${esc(top)}</div>`;
  if (est) h += `<div class="pe" style="font-size:${vert ? 2.8 : 2.9}mm">${esc(it.estado)}</div>`;
  if (pr) h += `<div class="pp" style="font-size:${fPr}mm">${fmt(it.precio)}</div>`;
  if (tr) h += vert
    ? `<div style="text-align:center;${pr ? 'border-top:0.3mm solid #000;padding-top:0.8mm' : ''}"><div class="pe" style="font-size:2.6mm;font-weight:700">TRANSFERENCIA</div><div class="pp" style="font-size:${fPr}mm">${fmt(it.transf)}</div></div>`
    : `<div class="pp" style="font-size:${fPr}mm;${pr ? 'border-top:0.3mm solid #000;padding-top:0.8mm' : ''}"><span style="font-size:${Math.min(2.8, fPr * .38)}mm;font-weight:700;letter-spacing:.3px;vertical-align:middle">TRANSFERENCIA</span> ${fmt(it.transf)}</div>`;
  if (bc) h += `<div style="display:flex;flex-direction:column;align-items:center"><svg></svg><div class="ps" style="font-size:${vert ? 3 : 3.1}mm">${esc(it.sku)}</div></div>`;
  h += '</div>';
  if (!forPrint) h += `<span class="qty">×${it.qty}</span>`;
  d.innerHTML = h;
  if (bc) {
    const svg = d.querySelector('svg');
    drawBarcode(svg, it.sku);
    const mods = 11 * it.sku.length + 35;
    const mw = Math.min(vert ? 0.3 : 0.5, (W - 6) / mods);
    svg.style.width = (mods * mw) + 'mm';
    svg.style.height = (two ? (vert ? (crowd >= 5 ? 16 : 19) : (crowd >= 5 ? 6 : 8)) : (vert ? (crowd >= 4 ? 22 : 26) : (crowd >= 4 ? 8.5 : (pr || tr ? 11.5 : 16)))) + 'mm';
  }
  return d;
}

// Etiqueta en ZPL (el idioma propio de la Zebra).
export function zplLabel(it, cfg) {
  const PF = cfg.pf;
  if (isCustom(cfg) || PF.barcode === false) return zplGen(it, cfg);
  if (cfg.ori === 's') return zplSmall(it, cfg);
  const dpm = +cfg.dpi, vert = cfg.ori === 'v';
  const W = Math.round((vert ? 40 : 80) * dpm), H = Math.round((vert ? 80 : 40) * dpm);
  const k = dpm / 8, q = v => Math.round(v * k);
  const shX = Math.round((+cfg.shiftX || 0) * dpm), shY = Math.round((+cfg.shiftY || 0) * dpm);
  const top = txt(lineTop(it, PF)), est = PF.estado && it.estado ? txt(String(it.estado).toUpperCase()) : '', pr = PF.precio, sku = PF.sku && it.sku ? txt(it.sku) : '';
  const tr = PF.transf && isFinite(it.transf) && it.transf > 0, two = pr && tr;
  const crowd = (top ? 1 : 0) + (est ? 1 : 0) + (pr ? 1 : 0) + (tr ? 1 : 0) + (sku ? 1 : 0);
  const m = q(16), bw = W - 2 * m;
  const blocks = [];
  if (top) { const hT = vert ? 28 : (crowd >= 4 ? 30 : 34); const lines = vert ? 2 : 1; blocks.push({ h: q(hT * lines + (lines - 1) * 4), z: y => `^FO${m},${y}^A0N,${q(hT)},${q(hT - 4)}^FB${bw},${lines},${q(4)},C^FD${top}^FS\n` }); }
  if (est) { blocks.push({ h: q(22), z: y => `^FO${m},${y}^A0N,${q(22)},${q(20)}^FB${bw},1,0,C^FD${est}^FS\n` }); }
  const hP = two ? (vert ? (crowd >= 5 ? 46 : 52) : (crowd >= 5 ? 50 : (sku ? 58 : 76))) : (vert ? (sku ? 62 : 84) : (sku ? (crowd >= 4 ? 74 : 84) : 120));
  if (pr) { blocks.push({ h: q(hP), z: y => `^FO${m},${y}^A0N,${q(hP)},${q(Math.round(hP * .93))}^FB${bw},1,0,C^FD${txt(fmt(it.precio))}^FS\n` }); }
  if (tr) {
    const pT = txt(fmt(it.transf)), lab = 'TRANSFERENCIA', hL = q(20);
    if (vert) {
      blocks.push({ h: hL + q(4) + q(hP), z: y => `^FO${m},${y}^A0N,${hL},${q(18)}^FB${bw},1,0,C^FD${lab}^FS\n^FO${m},${y + hL + q(4)}^A0N,${q(hP)},${q(Math.round(hP * .93))}^FB${bw},1,0,C^FD${pT}^FS\n` });
    } else {
      // prefijo chico + precio, centrados juntos (ancho estimado de la fuente 0)
      const wP = pT.length * q(hP) * .93 * .55, wL = lab.length * q(18) * .62, gapL = q(10), tot = wP + wL + gapL, x0 = Math.max(m, Math.round((W - tot) / 2));
      blocks.push({ h: q(hP), z: y => (pr ? `^FO${x0},${Math.max(0, y - q(6))}^GB${Math.round(tot)},2,2^FS\n` : '') + `^FO${x0},${y + q(hP) - hL - q(Math.round(hP * .12))}^A0N,${hL},${q(18)}^FD${lab}^FS\n^FO${Math.round(x0 + wL + gapL)},${y}^A0N,${q(hP)},${q(Math.round(hP * .93))}^FD${pT}^FS\n` });
    }
  }
  if (sku) {
    const mod128 = 11 * sku.length + 35;
    const by = vert ? (mod128 * 2 * k <= bw ? 2 : 1) : (mod128 * 4 * k <= bw ? 4 : mod128 * 3 * k <= bw ? 3 : mod128 * 2 * k <= bw ? 2 : 1);
    const byD = Math.max(1, Math.round(by * k)), bx = Math.max(m, Math.round((W - mod128 * byD) / 2));
    const bh = two ? (vert ? (crowd >= 5 ? 120 : 150) : (crowd >= 5 ? 44 : 56)) : (vert ? (crowd >= 4 ? 170 : 200) : (crowd >= 4 ? 66 : (pr || tr ? 90 : 130)));
    blocks.push({ h: q(bh + 28), z: y => `^FO${bx},${y}^BY${byD}^BCN,${q(bh)},Y,N,N^FD>:${sku}^FS\n` });
  }
  const used = blocks.reduce((a, b) => a + b.h, 0), gap = Math.max(0, Math.floor((H - used) / (blocks.length + 1)));
  let z = header(W, H, shX, shY, cfg);
  let y = gap; for (const b of blocks) { z += b.z(y); y += b.h + gap; }
  return z + `^PQ${it.qty},0,1,Y^XZ\n`;
}

/* ---------- Etiqueta de calibración ---------- */
export function calibrationEl(cfg) {
  const [W, H] = dimsMM(cfg.ori);
  const sh = +cfg.shiftX || 0, sy = +cfg.shiftY || 0;
  const d = document.createElement('div');
  d.className = 'plbl'; d.style.cssText = `width:${W}mm;height:${H}mm;position:relative`;
  d.innerHTML = `<div style="position:absolute;inset:0;transform:translate(${sh}mm,${sy}mm)">
      <div style="position:absolute;inset:1mm;border:0.4mm solid #000"></div>
      <div style="position:absolute;left:50%;top:0;bottom:0;border-left:0.3mm solid #000"></div>
      <div style="position:absolute;top:50%;left:0;right:0;border-top:0.3mm solid #000"></div>
      <div style="position:absolute;left:3mm;top:3mm;font:bold 3mm Arial">ARRIBA-IZQ</div>
      <div style="position:absolute;right:3mm;bottom:3mm;font:bold 3mm Arial">ABAJO-DER</div></div>`;
  return d;
}
export function calibrationZpl(cfg) {
  const [W, H] = dimsMM(cfg.ori);
  const dpm = +cfg.dpi, w = Math.round(W * dpm), hh = Math.round(H * dpm), m = Math.round(dpm);
  const shX = Math.round((+cfg.shiftX || 0) * dpm), shY = Math.round((+cfg.shiftY || 0) * dpm);
  return `^XA^PW${w}^LL${hh}^LS${-shX}^LT${shY}^FO${m},${m}^GB${w - 2 * m},${hh - 2 * m},3^FS^FO${w >> 1},0^GB2,${hh},2^FS^FO0,${hh >> 1}^GB${w},2,2^FS^FO${3 * m},${3 * m}^A0N,24,22^FDARRIBA-IZQ^FS^FO${w - 18 * m},${hh - 6 * m}^A0N,24,22^FDABAJO-DER^FS^XZ`;
}

/* ---------- Etiqueta con texto libre (carteles, avisos, "OFERTA") ---------- */
// st: { text, auto, fixed, align: 'C'|'L'|'R', bar, frame, qty }
export function freeTextState(raw) {
  const lines = String(raw.text ?? '').replace(/\r/g, '').split('\n').map(s => s.trim()).filter((s, i, a) => s || (i > 0 && i < a.length - 1)).slice(0, 12);
  return {
    lines, auto: raw.auto !== false, fixed: Math.max(1.5, parseFloat(String(raw.fixed ?? '').replace(',', '.')) || 6),
    align: raw.align || 'C', bar: norm(raw.bar), frame: !!raw.frame, qty: Math.max(1, parseInt(raw.qty) || 1),
  };
}
// ancho aproximado de un texto en "em" (letra negrita condensada tipo Zebra/Arial)
function emWidth(s) { let w = 0; for (const ch of s) { if (ch === ' ') w += .28; else if (/[MWmw@%]/.test(ch)) w += .86; else if (/[A-ZÁÉÍÓÚÑÜ]/.test(ch)) w += .68; else if (/[0-9$]/.test(ch)) w += .56; else if (/[iljItf.,:;!'|]/.test(ch)) w += .3; else w += .56; } return Math.max(w, .3); }
function ctLayout(st, W, H, cfg) {
  const inset = Math.max(0.6, Math.min(W, H) * 0.035), pad = st.frame ? inset + 0.45 + Math.max(1, Math.min(W, H) * 0.05) : Math.max(1.2, Math.min(W, H) * 0.06);
  const Wc = W - 2 * pad, Hc = H - 2 * pad;
  const hasBar = !!st.bar, mods = hasBar ? 11 * st.bar.length + 35 : 0;
  const dpm = +cfg.dpi;
  let mw = 0, barH = 0, barTxt = 0;
  if (hasBar) { mw = Math.max(1, Math.min(4 * dpm / 8, Math.floor((W - 2.5) / mods * dpm))) / dpm; barH = st.lines.length ? Math.min(Hc * 0.32, 15) : Math.min(Hc * 0.7, 40); barTxt = Math.max(1.6, Math.min(3, barH * 0.28)); }
  const availH = (Hc - (hasBar ? barH + barTxt + 0.6 : 0)) * 0.92;
  const LH = 1.18; // interlineado
  let fs;
  if (st.auto) {
    fs = st.lines.map(l => l ? Wc / (emWidth(l) * 1.12) : 0);
    const nonEmpty = fs.filter(Boolean);
    const cap = availH / LH; fs = fs.map(f => f ? Math.min(f, cap) : 0);
    const tot = fs.reduce((a, f) => a + (f || Math.min(...(nonEmpty.length ? nonEmpty : [3])) * 0.6) * LH, 0);
    const k = tot > availH ? availH / tot : 1; fs = fs.map(f => f * k);
  } else {
    fs = st.lines.map(l => l ? st.fixed : 0);
  }
  const blankH = Math.max(1, (fs.filter(Boolean).reduce((a, b) => Math.min(a, b), 99) || 3) * 0.6);
  const rows = st.lines.map((l, i) => ({ s: l, f: fs[i], h: (fs[i] || blankH) * LH }));
  const overflow = !st.auto && (rows.reduce((a, r) => a + r.h, 0) > availH + 0.1 || rows.some(r => r.s && emWidth(r.s) * 1.08 * r.f > Wc + 0.1));
  return { W, H, pad, inset, Wc, Hc, rows, hasBar, mods, mw, barH, barTxt, overflow };
}
export function freeTextEl(st, cfg, forPrint) {
  const [W, H] = dimsMM(cfg.ori), L = ctLayout(st, W, H, cfg);
  const sh = forPrint ? (+cfg.shiftX || 0) : 0, sy = forPrint ? (+cfg.shiftY || 0) : 0;
  const d = document.createElement('div'); d.className = 'plbl' + (forPrint ? '' : ' lbl');
  d.style.cssText = `width:${W}mm;height:${H}mm;padding:${L.pad}mm`;
  const ta = st.align === 'L' ? 'left' : st.align === 'R' ? 'right' : 'center';
  let h = `<div class="pin" style="transform:translate(${sh}mm,${sy}mm);justify-content:center;gap:0">`;
  if (st.frame) h += `<div style="position:absolute;inset:${L.inset}mm;border:0.45mm solid #000;border-radius:0.6mm"></div>`;
  h += `<div style="width:100%">` + L.rows.map(r => `<div style="font-weight:800;text-align:${ta};white-space:nowrap;overflow:hidden;font-size:${r.f || 1}mm;line-height:${r.h}mm;height:${r.h}mm">${r.s ? esc(r.s) : '&nbsp;'}</div>`).join('') + `</div>`;
  if (L.hasBar) h += `<div style="display:flex;flex-direction:column;align-items:${st.align === 'L' ? 'flex-start' : st.align === 'R' ? 'flex-end' : 'center'};width:100%;margin-top:0.6mm"><svg></svg><div class="ps" style="font-size:${L.barTxt}mm">${esc(st.bar)}</div></div>`;
  h += '</div>';
  d.innerHTML = h;
  if (L.hasBar) {
    const svg = d.querySelector('svg'); drawBarcode(svg, st.bar);
    svg.style.width = (L.mods * L.mw) + 'mm'; svg.style.height = L.barH + 'mm';
  }
  return { el: d, overflow: L.overflow };
}
export function freeTextZpl(st, cfg) {
  const dpm = +cfg.dpi, [Wm, Hm] = dimsMM(cfg.ori), L = ctLayout(st, Wm, Hm, cfg);
  const D = v => Math.round(v * dpm), W = D(Wm), H = D(Hm);
  const shX = D(+cfg.shiftX || 0), shY = D(+cfg.shiftY || 0);
  const px = D(L.pad), bw = W - 2 * px;
  let z = header(W, H, shX, shY, cfg);
  if (st.frame) { const i = D(L.inset); z += `^FO${i},${i}^GB${W - 2 * i},${H - 2 * i},${Math.max(2, D(0.45))},B,1^FS\n`; }
  const textH = L.rows.reduce((a, r) => a + D(r.h), 0), barBlock = L.hasBar ? D(0.6) + D(L.barH) + D(L.barTxt) : 0;
  let y = Math.max(0, Math.round((H - textH - barBlock) / 2));
  for (const r of L.rows) {
    if (r.s) { const fh = D(r.f); z += `^FO${px},${y + Math.round((D(r.h) - fh) / 2)}^A0N,${fh},${Math.round(fh * 0.93)}^FB${bw},1,0,${st.align}^FD${txt(r.s)}^FS\n`; }
    y += D(r.h);
  }
  if (L.hasBar) {
    y += D(0.6); const md = Math.max(1, Math.round(L.mw * dpm)), wbar = L.mods * md;
    const bx = st.align === 'L' ? px : st.align === 'R' ? Math.max(0, W - px - wbar) : Math.max(0, Math.round((W - wbar) / 2));
    z += `^FO${bx},${y}^BY${md}^BCN,${D(L.barH)},N,N,N^FD>:${txt(st.bar)}^FS\n`;
    z += `^FO${px},${y + D(L.barH) + D(0.2)}^A0N,${D(L.barTxt)},${Math.round(D(L.barTxt) * 0.93)}^FB${bw},1,0,${st.align}^FD${txt(st.bar)}^FS\n`;
  }
  return z + `^PQ${st.qty},0,1,Y^XZ\n`;
}

/* ---------- Envío a la impresora ---------- */

// Driver de Windows: arma las etiquetas en un área oculta, ajusta el tamaño de
// página y abre el cuadro de impresión de Chrome. La clase en <body> limita
// el @media print a estas impresiones (el resto del panel no se toca).
export function printWithDriver(elements, cfg) {
  const [W, H] = dimsMM(cfg.ori);
  let area = document.getElementById('zebraPrintArea');
  if (!area) { area = document.createElement('div'); area.id = 'zebraPrintArea'; document.body.appendChild(area); }
  let page = document.getElementById('zebraPageStyle');
  if (!page) { page = document.createElement('style'); page.id = 'zebraPageStyle'; document.head.appendChild(page); }
  area.replaceChildren(...elements);
  page.textContent = `@page{size:${W}mm ${H}mm;margin:0}`;
  document.body.classList.add('zebra-printing');
  const t0 = document.title; document.title = ' ';
  window.addEventListener('afterprint', () => {
    document.title = t0;
    document.body.classList.remove('zebra-printing');
    page.textContent = '';
    area.replaceChildren();
  }, { once: true });
  setTimeout(() => window.print(), 150);
  return { ok: true, text: `Enviando ${elements.length} etiqueta(s) a imprimir…` };
}

// "Directo a la Zebra": descarga un etiquetas_feria_….txt que el Ayudante
// Zebra (el .bat que corre en la PC de la impresora) manda a la ZD421.
export function downloadZpl(data, tag = '') {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const name = `etiquetas_feria_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}${tag}.txt`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain' })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return { ok: true, text: `Enviado al Ayudante Zebra (${name}). Si no imprime en unos segundos, abrí “Ayudante Zebra.bat”.` };
}

// Zebra Browser Print (servicio local de Zebra en el puerto 9100/9101).
const BPS = ['http://127.0.0.1:9100', 'http://localhost:9100', 'https://127.0.0.1:9101', 'https://localhost:9101'];
const tfetch = (u, o = {}, ms = 2500) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return fetch(u, { ...o, signal: c.signal }).finally(() => clearTimeout(t)); };
export async function sendBrowserPrint(data) {
  let base = null, dev = null, last = '';
  for (const b of BPS) {
    try {
      const r = await tfetch(b + '/default?type=printer'); const t = (await r.text()).trim();
      base = b; if (t) { dev = JSON.parse(t); break; }
      const r2 = await tfetch(b + '/available'); const j = await r2.json();
      if (j.printer && j.printer.length) { dev = j.printer.find(p => /zd4|zebra|zdesigner/i.test(p.name)) || j.printer[0]; break; }
      last = 'Browser Print está abierto pero no tiene ninguna impresora configurada';
    } catch { if (!last) last = 'no responde (¿está instalado y abierto?)'; }
  }
  if (!dev) return { ok: false, text: `Browser Print: ${last}. Probá otro método de impresión.` };
  try {
    const w = await tfetch(base + '/write', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ device: dev, data }) }, 15000);
    if (!w.ok) throw new Error('respondió ' + w.status);
    return { ok: true, text: `Enviado a ${dev.name} ✓` };
  } catch (e) {
    return { ok: false, text: `Error enviando a ${dev.name}: ${e.message}` };
  }
}

// Manda un lote según el método elegido. `elements()` arma las etiquetas para
// el driver (solo se llama si hace falta); `zpl` es el mismo lote en ZPL.
export async function sendToPrinter(cfg, { zpl, elements, tag }) {
  if (cfg.mode === 'drv') return printWithDriver(elements(), cfg);
  if (cfg.mode === 'bp') return sendBrowserPrint(zpl);
  return downloadZpl(zpl, tag);
}
