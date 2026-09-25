import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import { formatMoney, formatDateTime, formatTime, readAmount } from '../lib/feriaLabels.js';
import { Notice, EmptyState } from './ui.jsx';
import styles from './CashView.module.css';

const REFRESH_MS = 15 * 1000;
// Atajos para los gastos más comunes; el concepto igual se puede escribir.
const EXPENSE_SHORTCUTS = ['Comida', 'Librería', 'Limpieza', 'Transporte'];
const MOVEMENT_LABELS = { gasto: 'Gasto', retiro: 'Retiro' };

// Resumen de una caja: fondo, cada medio de pago por separado, el total y el
// efectivo que tiene que haber (fondo + ventas en efectivo − salidas).
function CashSummary({ summary }) {
  const mp = summary.byMethod.mercadopago;
  const expenses = summary.expenses ?? 0;
  const withdrawals = summary.withdrawals ?? 0;
  return (
    <dl className={styles.summary}>
      <div className={styles.row}><dt>Fondo inicial</dt><dd className="num">{formatMoney(summary.openingCash)}</dd></div>
      <div className={styles.row}><dt>Ventas en efectivo</dt><dd className="num">{formatMoney(summary.byMethod.efectivo)}</dd></div>
      <div className={styles.row}><dt>Ventas por transferencia</dt><dd className="num">{formatMoney(summary.byMethod.transferencia)}</dd></div>
      <div className={styles.row}><dt>Ventas con Mercado Pago</dt><dd className="num">{formatMoney(mp.total)}</dd></div>
      <div className={`${styles.row} ${styles.sub}`}><dt>Débito</dt><dd className="num">{formatMoney(mp.mp_debito)}</dd></div>
      <div className={`${styles.row} ${styles.sub}`}><dt>1 cuota</dt><dd className="num">{formatMoney(mp.mp_1_cuota)}</dd></div>
      <div className={`${styles.row} ${styles.sub}`}><dt>3 cuotas</dt><dd className="num">{formatMoney(mp.mp_3_cuotas)}</dd></div>
      <div className={`${styles.row} ${styles.total}`}>
        <dt>Total vendido <span className={styles.muted}>({summary.sales} {summary.sales === 1 ? 'venta' : 'ventas'}{summary.annulled ? `, ${summary.annulled} anulada${summary.annulled === 1 ? '' : 's'} sin sumar` : ''})</span></dt>
        <dd className="num">{formatMoney(summary.total)}</dd>
      </div>
      <div className={`${styles.row} ${styles.out}`}><dt>Gastos en efectivo</dt><dd className="num">− {formatMoney(expenses)}</dd></div>
      <div className={`${styles.row} ${styles.out}`}><dt>Retiros de dinero</dt><dd className="num">− {formatMoney(withdrawals)}</dd></div>
      <div className={`${styles.row} ${styles.cash}`}>
        <dt>Efectivo que tiene que haber en la caja <span className={styles.muted}>(fondo + ventas en efectivo − gastos − retiros)</span></dt>
        <dd className="num">{formatMoney(summary.expectedCash)}</dd>
      </div>
      {summary.countedCash != null && (
        <>
          <div className={styles.row}><dt>Efectivo contado</dt><dd className="num">{formatMoney(summary.countedCash)}</dd></div>
          <div className={`${styles.row} ${summary.difference === 0 ? '' : styles.diff}`}>
            <dt>Diferencia</dt>
            <dd className="num">{summary.difference > 0 ? '+ ' : ''}{formatMoney(summary.difference)}{summary.difference < 0 ? ' (falta)' : summary.difference > 0 ? ' (sobra)' : ''}</dd>
          </div>
        </>
      )}
    </dl>
  );
}

// Salidas de la caja (las anuladas quedan tachadas). `onVoid` solo en la
// caja abierta.
function MovementList({ movements, busy, onVoid }) {
  if (!movements?.length) return <p className={styles.muted}>Sin gastos ni retiros.</p>;
  return (
    <ul className={styles.movements}>
      {movements.map(m => (
        <li key={m.id} className={`${styles.movement} ${m.voidedAt ? styles.voided : ''}`}>
          <span className={styles.movementType}>{MOVEMENT_LABELS[m.type] ?? m.type}</span>
          <span className={styles.movementText}>
            {m.concept}
            <span className={styles.muted}> · {formatTime(m.at)} · {m.by}{m.voidedAt ? ` · anulado por ${m.voidedBy}` : ''}</span>
          </span>
          <span className="num">− {formatMoney(m.amount)}</span>
          {onVoid && !m.voidedAt && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onVoid(m)}>Anular</button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function CashView({ onChange }) {
  const [current, setCurrent] = useState(null); // { session, summary }
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState({ kind: '', text: '' });
  const [openingCash, setOpeningCash] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const [movement, setMovement] = useState({ type: 'gasto', concept: '', amount: '' });
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  // La observación se trae del servidor solo mientras no se esté escribiendo:
  // el refresco cada 15 s no puede pisar lo que Caja está tipeando.
  const notesDirty = useRef(false);

  const load = useCallback(async () => {
    try {
      const [cur, hist] = await Promise.all([apiFetch('/api/feria/cash/current'), apiFetch('/api/feria/cash/sessions')]);
      setCurrent(cur);
      if (!notesDirty.current) setNotes(cur.session?.notes ?? '');
      setSessions(hist.sessions);
      setError('');
    } catch (err) {
      setError(`No se pudo cargar la caja: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  async function run(request, successText) {
    setBusy(true);
    setNotice({ kind: '', text: '' });
    try {
      const result = await request();
      if (successText) setNotice({ kind: 'success', text: successText });
      return result;
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openCash(e) {
    e.preventDefault();
    const amount = readAmount(openingCash);
    if (amount == null) return setNotice({ kind: 'error', text: 'Escribí el fondo inicial en pesos (puede ser 0).' });
    const cur = await run(() => apiFetch('/api/feria/cash/open', { method: 'POST', body: JSON.stringify({ openingCash: amount }) }),
      `Caja abierta con ${formatMoney(amount)} de fondo. Ya se pueden confirmar ventas.`);
    if (!cur) return;
    setCurrent(cur);
    setOpeningCash('');
    notesDirty.current = false;
    setNotes('');
    onChange?.();
  }

  async function addMovement(e) {
    e.preventDefault();
    const amount = readAmount(movement.amount);
    if (!(amount > 0)) return setNotice({ kind: 'error', text: 'Escribí el monto que sale de la caja.' });
    if (movement.type === 'gasto' && !movement.concept.trim()) return setNotice({ kind: 'error', text: 'Escribí en qué se gastó (ej. comida, librería).' });
    const label = movement.type === 'gasto' ? `Gasto "${movement.concept.trim()}"` : 'Retiro';
    const cur = await run(() => apiFetch('/api/feria/cash/movements', {
      method: 'POST', body: JSON.stringify({ ...movement, amount }),
    }), `${label} de ${formatMoney(amount)} registrado: ya se descontó del efectivo esperado.`);
    if (!cur) return;
    setCurrent(cur);
    setMovement(m => ({ ...m, concept: '', amount: '' }));
  }

  async function voidMovement(m) {
    if (!window.confirm(`¿Anular "${m.concept}" de ${formatMoney(m.amount)}? Vuelve a contar como efectivo en la caja.`)) return;
    const cur = await run(() => apiFetch(`/api/feria/cash/movements/${m.id}/void`, { method: 'POST' }), 'Salida anulada.');
    if (cur) setCurrent(cur);
  }

  async function saveNotes() {
    const cur = await run(() => apiFetch('/api/feria/cash/notes', { method: 'PATCH', body: JSON.stringify({ notes }) }), 'Observación guardada.');
    if (!cur) return;
    notesDirty.current = false;
    setCurrent(cur);
  }

  async function closeCash(e) {
    e.preventDefault();
    const amount = readAmount(countedCash);
    if (amount == null) return setNotice({ kind: 'error', text: 'Contá el efectivo de la caja y escribí el monto.' });
    if (!window.confirm(`¿Cerrar la caja con ${formatMoney(amount)} en efectivo? Después no se pueden confirmar ventas hasta abrir una nueva.`)) return;
    // La observación viaja con el cierre aunque no se haya guardado aparte.
    const result = await run(() => apiFetch('/api/feria/cash/close', {
      method: 'POST', body: JSON.stringify({ countedCash: amount, notes }),
    }));
    if (!result) return;
    const { session: closed } = result;
    setCountedCash('');
    notesDirty.current = false;
    setNotes('');
    setOpenId(closed.id);
    const diff = closed.summary.difference;
    setNotice({
      kind: diff === 0 ? 'success' : 'error',
      text: `Caja cerrada. Total vendido ${formatMoney(closed.summary.total)}. ${diff === 0 ? 'El efectivo cierra justo.' : `Diferencia de efectivo: ${formatMoney(diff)}.`}`,
    });
    await load();
    onChange?.();
  }

  const session = current?.session;
  const summary = current?.summary;
  const counted = readAmount(countedCash);
  const liveDiff = summary && counted != null ? Math.round((counted - summary.expectedCash) * 100) / 100 : null;
  const notesChanged = (session?.notes ?? '') !== notes.trim();

  return (
    <div className={styles.body}>
      <Notice kind="error">{error}</Notice>
      <Notice kind={notice.kind || 'info'} onClose={() => setNotice({ kind: '', text: '' })}>{notice.text}</Notice>

      {current && !session && (
        <section className={styles.card}>
          <h2 className={styles.title}>La caja está cerrada</h2>
          <p className={styles.muted}>Abrila para empezar el día: sin caja abierta no se pueden confirmar ventas.</p>
          <form className={styles.form} onSubmit={openCash}>
            <label className="field">
              <span>Fondo inicial en efectivo</span>
              <input className="input" inputMode="decimal" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="Ej. 20000" autoFocus />
            </label>
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Abriendo…' : 'Abrir caja'}</button>
          </form>
        </section>
      )}

      {session && summary && (
        <section className={styles.card}>
          <div className={styles.head}>
            <h2 className={styles.title}>Caja abierta</h2>
            <p className={styles.muted}>Desde {formatDateTime(session.openedAt)} · abrió {session.openedBy}</p>
          </div>
          <CashSummary summary={summary} />

          <div className={styles.block}>
            <h3 className={styles.subtitle}>Salidas de caja</h3>
            <p className={styles.muted}>Gastos y retiros en efectivo: se descuentan del efectivo que tiene que haber al cerrar.</p>
            <form className={styles.movementForm} onSubmit={addMovement}>
              <div className={styles.segmented} role="radiogroup" aria-label="Tipo de salida">
                {Object.entries(MOVEMENT_LABELS).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={movement.type === value}
                    className={movement.type === value ? styles.segmentActive : ''}
                    onClick={() => setMovement(m => ({ ...m, type: value }))}>
                    {value === 'retiro' ? 'Retiro de dinero' : label}
                  </button>
                ))}
              </div>
              {movement.type === 'gasto' && (
                <div className={styles.shortcuts}>
                  {EXPENSE_SHORTCUTS.map(c => (
                    <button key={c} type="button" className={`btn btn-sm ${movement.concept === c ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setMovement(m => ({ ...m, concept: c }))}>{c}</button>
                  ))}
                </div>
              )}
              <div className={styles.form}>
                <label className="field">
                  <span>{movement.type === 'gasto' ? 'Concepto' : 'Detalle (opcional)'}</span>
                  <input className="input" value={movement.concept} maxLength={120}
                    placeholder={movement.type === 'gasto' ? 'Ej. almuerzo del equipo' : 'Ej. retiro para depositar'}
                    onChange={(e) => setMovement(m => ({ ...m, concept: e.target.value }))} />
                </label>
                <label className={`field ${styles.amountField}`}>
                  <span>Monto</span>
                  <input className="input num" inputMode="decimal" value={movement.amount} placeholder="Ej. 5000"
                    onChange={(e) => setMovement(m => ({ ...m, amount: e.target.value }))} />
                </label>
                <button type="submit" className="btn btn-secondary btn-lg" disabled={busy}>Registrar salida</button>
              </div>
            </form>
            <MovementList movements={session.movements} busy={busy} onVoid={voidMovement} />
          </div>

          <div className={styles.block}>
            <h3 className={styles.subtitle}>Observación de la caja</h3>
            <textarea className="input" rows={2} value={notes} maxLength={1000}
              onChange={(e) => { notesDirty.current = true; setNotes(e.target.value); }}
              placeholder="Ej. faltante explicado, cambio que se pidió, algo a revisar…" />
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !notesChanged} onClick={saveNotes}>
              Guardar observación
            </button>
          </div>

          <form className={styles.closeForm} onSubmit={closeCash}>
            <h3 className={styles.subtitle}>Cerrar la caja</h3>
            <label className="field">
              <span>Efectivo contado en la caja</span>
              <input className="input" inputMode="decimal" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} placeholder={`Tendría que haber ${formatMoney(summary.expectedCash)}`} />
            </label>
            {liveDiff != null && (
              <p className={`num ${liveDiff === 0 ? styles.ok : styles.diff}`}>
                {liveDiff === 0 ? 'Cierra justo.' : `Diferencia: ${liveDiff > 0 ? '+ ' : ''}${formatMoney(liveDiff)} ${liveDiff < 0 ? '(falta)' : '(sobra)'}`}
              </p>
            )}
            <button type="submit" className="btn btn-danger btn-lg" disabled={busy}>{busy ? 'Un momento…' : 'Cerrar caja'}</button>
          </form>
        </section>
      )}

      <section className={styles.history}>
        <h3 className={styles.subtitle}>Cajas cerradas</h3>
        {sessions.length === 0 && <EmptyState title="Todavía no se cerró ninguna caja">Cada cierre queda guardado acá con su resumen.</EmptyState>}
        <ul className={styles.list}>
          {sessions.map(s => {
            const open = openId === s.id;
            return (
              <li key={s.id} className={styles.item}>
                <button type="button" className={styles.itemRow} onClick={() => setOpenId(open ? null : s.id)} aria-expanded={open}>
                  <span>
                    <strong>{formatDateTime(s.openedAt)} a {formatDateTime(s.closedAt)}</strong>
                    <span className={styles.muted}> · cerró {s.closedBy}</span>
                  </span>
                  <span className={styles.itemSide}>
                    <span className="num">{formatMoney(s.summary.total)}</span>
                    {s.summary.difference !== 0 && <span className={`num ${styles.diff}`}>dif. {formatMoney(s.summary.difference)}</span>}
                  </span>
                </button>
                {open && (
                  <div className={styles.itemDetail}>
                    <CashSummary summary={s.summary} />
                    <h4 className={styles.detailTitle}>Salidas</h4>
                    <MovementList movements={s.movements} />
                    {s.notes && <p className={styles.notes}><strong>Observación:</strong> {s.notes}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
