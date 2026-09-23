import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { formatMoney, formatDateTime } from '../lib/feriaLabels.js';
import { Notice, EmptyState } from './ui.jsx';
import styles from './CashView.module.css';

const REFRESH_MS = 15 * 1000;

// Lee un monto escrito a mano ("20000", "20.000", "20000,50"). null si no es válido.
function readAmount(text) {
  const raw = String(text).trim().replace(/[$\s]/g, '');
  // Con coma, la coma es decimal y los puntos son de miles; sin coma, los
  // puntos son de miles solo si agrupan de a tres (20.000).
  const clean = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw;
  if (clean === '') return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Resumen de una caja: fondo, cada medio de pago por separado y el total.
function CashSummary({ summary }) {
  const mp = summary.byMethod.mercadopago;
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
      <div className={`${styles.row} ${styles.cash}`}>
        <dt>Efectivo que tiene que haber en la caja <span className={styles.muted}>(fondo + ventas en efectivo)</span></dt>
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

export default function CashView({ onChange }) {
  const [current, setCurrent] = useState(null); // { session, summary }
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState({ kind: '', text: '' });
  const [openingCash, setOpeningCash] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [cur, hist] = await Promise.all([apiFetch('/api/feria/cash/current'), apiFetch('/api/feria/cash/sessions')]);
      setCurrent(cur);
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

  async function openCash(e) {
    e.preventDefault();
    const amount = readAmount(openingCash);
    if (amount == null) return setNotice({ kind: 'error', text: 'Escribí el fondo inicial en pesos (puede ser 0).' });
    setBusy(true);
    setNotice({ kind: '', text: '' });
    try {
      setCurrent(await apiFetch('/api/feria/cash/open', { method: 'POST', body: JSON.stringify({ openingCash: amount }) }));
      setOpeningCash('');
      setNotice({ kind: 'success', text: `Caja abierta con ${formatMoney(amount)} de fondo. Ya se pueden confirmar ventas.` });
      onChange?.();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function closeCash(e) {
    e.preventDefault();
    const amount = readAmount(countedCash);
    if (amount == null) return setNotice({ kind: 'error', text: 'Contá el efectivo de la caja y escribí el monto.' });
    if (!window.confirm(`¿Cerrar la caja con ${formatMoney(amount)} en efectivo? Después no se pueden confirmar ventas hasta abrir una nueva.`)) return;
    setBusy(true);
    setNotice({ kind: '', text: '' });
    try {
      const { session } = await apiFetch('/api/feria/cash/close', {
        method: 'POST', body: JSON.stringify({ countedCash: amount, notes }),
      });
      setCountedCash('');
      setNotes('');
      setOpenId(session.id);
      const diff = session.summary.difference;
      setNotice({
        kind: diff === 0 ? 'success' : 'error',
        text: `Caja cerrada. Total vendido ${formatMoney(session.summary.total)}. ${diff === 0 ? 'El efectivo cierra justo.' : `Diferencia de efectivo: ${formatMoney(diff)}.`}`,
      });
      await load();
      onChange?.();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const session = current?.session;
  const summary = current?.summary;
  const counted = readAmount(countedCash);
  const liveDiff = summary && counted != null ? Math.round((counted - summary.expectedCash) * 100) / 100 : null;

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
            <label className="field">
              <span>Notas (opcional)</span>
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. retiro de efectivo, faltante explicado…" />
            </label>
            <button type="submit" className="btn btn-danger btn-lg" disabled={busy}>{busy ? 'Cerrando…' : 'Cerrar caja'}</button>
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
                    {s.notes && <p className={styles.muted}>Notas: {s.notes}</p>}
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
