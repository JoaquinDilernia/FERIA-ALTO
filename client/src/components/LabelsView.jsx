import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../lib/api.js';
import { formatMoney } from '../lib/feriaLabels.js';
import {
  useLabelQueue, addLabel, refreshLabelsFrom, markLabelsMissing, setLabelQty, removeLabel, clearLabels, toPrintable,
} from '../lib/labelQueue.js';
import {
  BUILTIN_SIZES, DEFAULT_CONFIG, customSizeId, fmtMM, dimsMM, labelEl, zplLabel, calibrationEl, calibrationZpl,
  freeTextState, freeTextEl, freeTextZpl, sendToPrinter,
} from '../lib/zebraLabels.js';
import { ProductPhoto, ConditionChip, EmptyState, Notice } from './ui.jsx';
import styles from './LabelsView.module.css';

const SEARCH_MIN_CHARS = 4;
const REBAJA_LABELS = { 1: 'Rebaja 1', 2: 'Rebaja 2', 3: 'Rebaja 3' };
const PREVIEW_MAX = 24;
const CONFIG_KEY = 'feria_etiquetas_config';
const FREE_TEXT_KEY = 'feria_etiquetas_texto';

const FIELDS = [
  { f: 'modelo', label: 'Modelo' },
  { f: 'color', label: 'Color' },
  { f: 'estado', label: 'Condición (Falla / Discontinuo)' },
  { f: 'precio', label: 'Precio' },
  { f: 'transf', label: 'Transferencia (precio − 15%)' },
  { f: 'sku', label: 'SKU' },
  { f: 'barcode', label: 'Código de barras del SKU' },
];

const MODES = [
  { value: 'zpl', label: 'Directo a la Zebra (Ayudante Zebra) – recomendado' },
  { value: 'drv', label: 'Driver de Windows (cuadro de impresión de Chrome)' },
  { value: 'bp', label: 'Zebra Browser Print' },
];

function loadJson(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key)) }; } catch { return fallback; }
}
function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
}

// Muestra elementos del DOM armados por el motor de etiquetas.
function DomPreview({ build, className }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.replaceChildren(...build()); }, [build]);
  return <div ref={ref} className={className} />;
}

// Pestaña "Etiquetas" de Caja: imprime en la Zebra ZD421 las etiquetas de
// precio de la cola (que se llena acá o desde Productos y Rebajas). El precio
// sale siempre del SKU: el vigente de la condición, con la rebaja activa.
export default function LabelsView() {
  const queue = useLabelQueue();
  const [cfg, setCfgState] = useState(() => {
    const c = loadJson(CONFIG_KEY, DEFAULT_CONFIG);
    return { ...c, pf: { ...DEFAULT_CONFIG.pf, ...c.pf } };
  });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState({ kind: '', text: '' });
  const [showZpl, setShowZpl] = useState(false);
  const [newSize, setNewSize] = useState({ w: '', h: '' });
  const [freeText, setFreeText] = useState(() => loadJson(FREE_TEXT_KEY, { text: '', auto: true, fixed: '6', align: 'C', bar: '', frame: false, qty: 1 }));
  const searchTimeout = useRef(null);

  function setCfg(patch) {
    setCfgState(prev => {
      const next = { ...prev, ...patch };
      saveJson(CONFIG_KEY, next);
      return next;
    });
  }
  function setFree(patch) {
    setFreeText(prev => {
      const next = { ...prev, ...patch };
      saveJson(FREE_TEXT_KEY, next);
      return next;
    });
  }

  // El corrimiento ("Mover") se guarda por tamaño de etiqueta.
  const shift = cfg.shifts?.[cfg.ori] ?? { x: 0, y: 0 };
  const printCfg = useMemo(() => ({ ...cfg, shiftX: shift.x, shiftY: shift.y }), [cfg, shift.x, shift.y]);
  const setShift = (axis, value) => setCfg({ shifts: { ...cfg.shifts, [cfg.ori]: { ...shift, [axis]: value } } });

  const printable = queue.filter(i => !i.missing && i.precio > 0 && i.qty > 0).map(toPrintable);
  const totalLabels = printable.reduce((a, b) => a + b.qty, 0);
  const [W, H] = dimsMM(cfg.ori);

  // Al entrar se vuelven a pedir los precios de lo que está en la cola: si
  // alguien cambió una rebaja en otra PC, la etiqueta sale con el precio nuevo.
  const refreshPrices = useCallback(async () => {
    const skus = [...new Set(queue.map(i => i.sku))];
    if (!skus.length) return;
    setRefreshing(true);
    let failed = 0;
    for (let i = 0; i < skus.length; i += 4) {
      await Promise.all(skus.slice(i, i + 4).map(async sku => {
        try {
          const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(sku)}`);
          const product = products.find(p => p.sku === sku);
          if (product) refreshLabelsFrom(product);
          else markLabelsMissing(sku);
        } catch {
          failed++;
        }
      }));
    }
    setRefreshing(false);
    if (failed) setStatus({ kind: 'error', text: `No se pudieron actualizar los precios de ${failed} producto(s). Probá de nuevo antes de imprimir.` });
  }, [queue]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshPrices(); }, []);

  function handleQueryChange(value) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    if (value.trim().length < SEARCH_MIN_CHARS) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        setResults((await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(value)}`)).products);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  // Enter con un SKU exacto (o un solo resultado con una sola condición) lo agrega directo: sirve con lector de códigos.
  function handleSearchKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exact = results.find(p => p.sku.toUpperCase() === query.trim().toUpperCase()) ?? (results.length === 1 ? results[0] : null);
    if (!exact) return;
    const conds = ['falla', 'discontinuo'].filter(c => exact.condiciones[c].disponible);
    if (conds.length !== 1) return;
    addLabel(exact, conds[0]);
    setQuery('');
    setResults([]);
  }

  async function print(list, tag) {
    if (!list.length) return;
    setStatus({ kind: 'info', text: 'Enviando…' });
    const result = await sendToPrinter(printCfg, {
      zpl: list.map(it => zplLabel(it, printCfg)).join(''),
      elements: () => list.flatMap(it => Array.from({ length: it.qty }, () => labelEl(it, printCfg, true))),
      tag,
    });
    setStatus({ kind: result.ok ? 'success' : 'error', text: result.text });
  }

  async function printCalibration() {
    const result = await sendToPrinter(printCfg, { zpl: calibrationZpl(printCfg), elements: () => [calibrationEl(printCfg)], tag: '_calibracion' });
    setStatus({ kind: result.ok ? 'success' : 'error', text: result.text });
  }

  const ft = freeTextState(freeText);
  const ftReady = ft.lines.some(Boolean) || !!ft.bar;
  async function printFreeText(qty) {
    const st = { ...ft, qty: qty ?? ft.qty };
    const result = await sendToPrinter(printCfg, {
      zpl: freeTextZpl(st, printCfg),
      elements: () => Array.from({ length: st.qty }, () => freeTextEl(st, printCfg, true).el),
      tag: `_texto_${st.qty}u`,
    });
    setStatus({ kind: result.ok ? 'success' : 'error', text: result.text });
  }

  function downloadCopy() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([printable.map(it => zplLabel(it, printCfg)).join('')], { type: 'text/plain' }));
    a.download = `copia_zpl_${new Date().toISOString().slice(0, 10)}.zpl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function addSize() {
    const w = Math.round(parseFloat(String(newSize.w).replace(',', '.')) * 10) / 10;
    const h = Math.round(parseFloat(String(newSize.h).replace(',', '.')) * 10) / 10;
    if (!(w >= 15 && w <= 104 && h >= 10 && h <= 300)) {
      setStatus({ kind: 'error', text: 'Medidas no válidas: ancho entre 15 y 104 mm (ancho máximo de la ZD421), alto entre 10 y 300 mm.' });
      return;
    }
    const custom = cfg.customSizes.some(s => s.w === w && s.h === h) ? cfg.customSizes : [...cfg.customSizes, { w, h }];
    setCfg({ customSizes: custom, ori: customSizeId({ w, h }) });
    setNewSize({ w: '', h: '' });
  }
  function removeSize() {
    setCfg({ customSizes: cfg.customSizes.filter(s => customSizeId(s) !== cfg.ori), ori: 'h' });
  }

  const previewKey = JSON.stringify([printable.slice(0, PREVIEW_MAX), printCfg.ori, printCfg.dpi, printCfg.pf]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const buildPreview = useCallback(() => printable.slice(0, PREVIEW_MAX).map(it => labelEl(it, printCfg, false)), [previewKey]);
  const freeKey = JSON.stringify([ft, printCfg.ori, printCfg.dpi]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const buildFreePreview = useCallback(() => (ftReady ? [freeTextEl(ft, printCfg, false).el] : []), [freeKey]);
  const freeOverflow = ftReady && freeTextEl(ft, printCfg, false).overflow;

  return (
    <div className={styles.body}>
      {/* 1 · Agregar productos */}
      <section className={styles.card}>
        <label className={styles.title} htmlFor="label-search">Agregar etiquetas</label>
        <p className={styles.muted}>El precio sale del SKU: el vigente de esa condición, con la rebaja activa. También se agregan desde Productos y Rebajas.</p>
        <input id="label-search" className={`input ${styles.search}`} value={query} autoComplete="off"
          placeholder="SKU o modelo, mínimo 4 caracteres" onChange={(e) => handleQueryChange(e.target.value)} onKeyDown={handleSearchKey} />
        {searching && <p className={styles.muted}>Buscando…</p>}
        {!searching && query.trim().length >= SEARCH_MIN_CHARS && results.length === 0 && (
          <p className={styles.muted}>No hay productos de la feria que coincidan con “{query}”.</p>
        )}
        {results.length > 0 && (
          <ul className={styles.results}>
            {results.map(p => (
              <li key={p.sku} className={styles.result}>
                <ProductPhoto sku={p.sku} alt={p.modelo} size={48} />
                <div className={styles.resultInfo}>
                  <p className={styles.name}>{p.modelo}</p>
                  <p className={styles.muted}>{p.sku}{p.color ? ` · ${p.color.trim()}` : ''}</p>
                </div>
                <div className={styles.resultActions}>
                  {['falla', 'discontinuo'].map(c => p.condiciones[c].disponible && (
                    <button key={c} type="button" className={`btn btn-secondary btn-sm cond-${c} ${styles.addBtn}`} onClick={() => addLabel(p, c)}>
                      + {c === 'falla' ? 'Falla' : 'Discontinuo'} <span className="num">{formatMoney(p.condiciones[c].precioTabla)}</span>
                      {p.condiciones[c].rebajaActiva > 0 && <span className={styles.rebaja}>{REBAJA_LABELS[p.condiciones[c].rebajaActiva]}</span>}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2 · Cola */}
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.title}>A imprimir <span className={`num ${styles.count}`}>{totalLabels} etiqueta{totalLabels === 1 ? '' : 's'}</span></h2>
          <div className={styles.headActions}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={refreshPrices} disabled={refreshing || !queue.length}>
              {refreshing ? 'Actualizando precios…' : '↻ Actualizar precios'}
            </button>
            <button type="button" className="btn btn-danger btn-sm" disabled={!queue.length}
              onClick={() => window.confirm('¿Vaciar la lista de etiquetas?') && clearLabels()}>Vaciar</button>
          </div>
        </div>
        {queue.length === 0 ? (
          <EmptyState title="No hay etiquetas cargadas">Buscá un producto arriba o tocá “+ Etiqueta” en Productos o Rebajas.</EmptyState>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Producto</th><th>Condición</th><th className={styles.r}>Precio</th><th className={styles.r}>Transf.</th><th className={styles.r}>Copias</th><th /></tr>
              </thead>
              <tbody>
                {queue.map(item => {
                  const it = toPrintable(item);
                  const bad = item.missing || !(item.precio > 0);
                  return (
                    <tr key={item.key} className={bad ? styles.bad : ''}>
                      <td>
                        <span className={styles.name}>{item.modelo}</span>
                        <span className={styles.muted}>{item.sku}{item.color ? ` · ${item.color}` : ''}</span>
                      </td>
                      <td>
                        <ConditionChip condition={item.condition} />
                        {item.rebaja > 0 && <span className={styles.rebaja}>{REBAJA_LABELS[item.rebaja]}</span>}
                      </td>
                      <td className={`num ${styles.r}`}>{bad ? 'Ya no está a la venta' : formatMoney(it.precio)}</td>
                      <td className={`num ${styles.r}`}>{bad ? '' : formatMoney(it.transf)}</td>
                      <td className={styles.r}>
                        <input type="number" min="0" className={`input num ${styles.qty}`} value={item.qty} aria-label={`Copias de ${item.sku}`}
                          onChange={(e) => setLabelQty(item.key, parseInt(e.target.value) || 0)} />
                      </td>
                      <td>
                        <button type="button" className={styles.remove} onClick={() => removeLabel(item.key)} aria-label={`Quitar ${item.sku}`}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3 · Vista previa + imprimir */}
      {printable.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.title}>Vista previa <span className={styles.muted}>{fmtMM(W)} × {fmtMM(H)} mm{printable.length > PREVIEW_MAX ? ` · primeras ${PREVIEW_MAX}` : ''}</span></h2>
          <DomPreview build={buildPreview} className={styles.labels} />
          <div className={styles.printBar}>
            <button type="button" className="btn btn-secondary" onClick={() => print([{ ...printable[0], qty: 1 }], '_prueba')}>Imprimir 1 de prueba</button>
            <button type="button" className="btn btn-primary" onClick={() => print(printable, `_${totalLabels}u`)}>Imprimir todo ({totalLabels})</button>
          </div>
        </section>
      )}

      <Notice kind={status.kind || 'info'} onClose={() => setStatus({ kind: '', text: '' })}>{status.text}</Notice>

      {/* 4 · Configuración (se guarda en esta PC) */}
      <details className={styles.card}>
        <summary className={styles.summary}>Impresora y diseño de etiqueta <span className={styles.muted}>· {MODES.find(m => m.value === cfg.mode)?.label.split(' (')[0]} · {fmtMM(W)} × {fmtMM(H)} mm</span></summary>
        <div className={styles.grid}>
          <label className="field">
            <span className="field-label">Método de impresión</span>
            <select className="select" value={cfg.mode} onChange={(e) => setCfg({ mode: e.target.value })}>
              {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Tamaño</span>
            <select className="select" value={cfg.ori} onChange={(e) => setCfg({ ori: e.target.value })}>
              {BUILTIN_SIZES.map(s => <option key={s.v} value={s.v}>{s.w} ancho × {s.h} alto mm</option>)}
              {cfg.customSizes.map(s => <option key={customSizeId(s)} value={customSizeId(s)}>{fmtMM(s.w)} ancho × {fmtMM(s.h)} alto mm · agregado</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Resolución</span>
            <select className="select" value={cfg.dpi} onChange={(e) => setCfg({ dpi: +e.target.value })}>
              <option value={8}>203 dpi (estándar ZD421)</option>
              <option value={12}>300 dpi</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Oscuridad (0-30)</span>
            <input type="number" min="0" max="30" className="input" value={cfg.dark} onChange={(e) => setCfg({ dark: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Mover → derecha / ← izq. (mm)</span>
            <input type="number" step="0.5" className="input" value={shift.x} onChange={(e) => setShift('x', e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Mover ↓ abajo / ↑ arriba (mm)</span>
            <input type="number" step="0.5" className="input" value={shift.y} onChange={(e) => setShift('y', e.target.value)} />
          </label>
        </div>

        <div className={styles.sizeRow}>
          <span className={styles.muted}>Nuevo tamaño:</span>
          <input className={`input ${styles.mm}`} inputMode="decimal" placeholder="Ancho" value={newSize.w} onChange={(e) => setNewSize({ ...newSize, w: e.target.value })} />
          <span>×</span>
          <input className={`input ${styles.mm}`} inputMode="decimal" placeholder="Alto" value={newSize.h} onChange={(e) => setNewSize({ ...newSize, h: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addSize()} />
          <span className={styles.muted}>mm</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addSize}>Agregar tamaño</button>
          {cfg.ori.startsWith('c') && <button type="button" className="btn btn-danger btn-sm" onClick={removeSize}>Quitar este tamaño</button>}
        </div>

        <fieldset className={styles.fields}>
          <legend className="field-label">Qué va en la etiqueta</legend>
          {FIELDS.map(({ f, label }) => (
            <label key={f} className={styles.check}>
              <input type="checkbox" checked={!!cfg.pf[f]} onChange={(e) => setCfg({ pf: { ...cfg.pf, [f]: e.target.checked } })} /> {label}
            </label>
          ))}
        </fieldset>

        <p className={styles.hint}>
          {cfg.mode === 'zpl' && <>La etiqueta va en el idioma de la impresora (ZPL), así sale igual que la vista previa aunque el driver tenga otro tamaño de papel. Necesita el <b>Ayudante Zebra</b> abierto en esta PC: al imprimir se descarga un <i>etiquetas_feria_….txt</i> y el ayudante lo manda a la ZD421. La primera vez Chrome puede preguntar si permite descargar varios archivos: aceptá.</>}
          {cfg.mode === 'drv' && <>Se abre el cuadro de impresión: elegí <b>ZDesigner ZD421</b> y en <b>Más opciones</b> Márgenes <b>Ninguno</b>, Escala <b>100%</b> y destildá <b>Encabezados y pies de página</b>. Si sale corrida, imprimí la etiqueta de calibración y corregí con “Mover”.</>}
          {cfg.mode === 'bp' && <>Zebra Browser Print tiene que estar instalado y abierto, con la ZD421 como <b>Default Device</b>. La primera vez puede pedir permiso para esta página: aceptalo.</>}
        </p>
        <div className={styles.printBar}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={printCalibration}>Etiqueta de calibración</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!printable.length} onClick={downloadCopy}>Descargar .zpl</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!printable.length} onClick={() => setShowZpl(v => !v)}>{showZpl ? 'Ocultar' : 'Ver'} código ZPL</button>
        </div>
        {showZpl && <pre className={styles.zpl}>{printable.map(it => zplLabel(it, printCfg)).join('')}</pre>}
      </details>

      {/* 5 · Texto libre */}
      <details className={styles.card}>
        <summary className={styles.summary}>Etiqueta con texto libre <span className={styles.muted}>· carteles, avisos, “OFERTA”</span></summary>
        <div className={styles.freeGrid}>
          <div className={styles.freeForm}>
            <label className="field">
              <span className="field-label">Texto (cada renglón es una línea de la etiqueta)</span>
              <textarea className="input" rows={4} value={freeText.text} placeholder={'OFERTA\n2x1 en tazas'} onChange={(e) => setFree({ text: e.target.value })} />
            </label>
            <div className={styles.grid}>
              <label className="field">
                <span className="field-label">Tamaño de letra</span>
                <select className="select" value={freeText.auto ? 'auto' : 'fixed'} onChange={(e) => setFree({ auto: e.target.value === 'auto' })}>
                  <option value="auto">Automático (lo más grande que entre)</option>
                  <option value="fixed">Fijo…</option>
                </select>
              </label>
              {!freeText.auto && (
                <label className="field">
                  <span className="field-label">Alto de letra (mm)</span>
                  <input className="input" inputMode="decimal" value={freeText.fixed} onChange={(e) => setFree({ fixed: e.target.value })} />
                </label>
              )}
              <label className="field">
                <span className="field-label">Alineación</span>
                <select className="select" value={freeText.align} onChange={(e) => setFree({ align: e.target.value })}>
                  <option value="C">Centrado</option>
                  <option value="L">Izquierda</option>
                  <option value="R">Derecha</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Código de barras (opcional)</span>
                <input className="input" value={freeText.bar} placeholder="Ej: MMC017MB" onChange={(e) => setFree({ bar: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Copias</span>
                <input type="number" min="1" className="input" value={freeText.qty} onChange={(e) => setFree({ qty: e.target.value })} />
              </label>
              <label className={styles.check}>
                <input type="checkbox" checked={!!freeText.frame} onChange={(e) => setFree({ frame: e.target.checked })} /> Marco
              </label>
            </div>
            <div className={styles.printBar}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!ftReady} onClick={() => printFreeText(1)}>Imprimir 1 de prueba</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={!ftReady} onClick={() => printFreeText()}>Imprimir ({ft.qty})</button>
            </div>
          </div>
          <div>
            {ftReady ? <DomPreview build={buildFreePreview} className={styles.freePreview} /> : <p className={styles.muted}>Escribí un texto para ver cómo queda.</p>}
            {freeOverflow && <p className={styles.warn}>Con ese tamaño de letra el texto no entra: achicalo o usá “Automático”.</p>}
          </div>
        </div>
      </details>
    </div>
  );
}
