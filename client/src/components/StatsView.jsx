import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { formatMoney, CONDITION_LABELS, DELIVERY_LABELS } from '../lib/feriaLabels.js';
import { PaymentChip, Notice, EmptyState } from './ui.jsx';
import styles from './StatsView.module.css';

const RANGES = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'ayer', label: 'Ayer' },
  { value: 'todo', label: 'Toda la feria' },
];
const REFRESH_MS = 60 * 1000;
// Franja visible del gráfico por hora: el horario de la feria. Si hubo ventas
// fuera de franja, se amplía para mostrarlas.
const DEFAULT_HOURS = [9, 21];

const fmtInt = (n) => n.toLocaleString('es-AR');

// Lista de barras horizontales de una sola medida: la barra da la proporción
// y el número escrito da el valor exacto (no depende del color).
function BarList({ rows, emptyText }) {
  if (!rows.length) return <p className={styles.muted}>{emptyText}</p>;
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <ul className={styles.barList}>
      {rows.map(r => (
        <li key={r.key} className={styles.barRow}>
          <div className={styles.barHead}>
            <span className={styles.barLabel}>{r.label}</span>
            <span className={`num ${styles.barValue}`}>{formatMoney(r.value)}</span>
          </div>
          <div className={styles.track} aria-hidden="true">
            <div className={styles.bar} style={{ width: `${Math.max((r.value / max) * 100, 1)}%` }} />
          </div>
          {r.sub && <p className={styles.barSub}>{r.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

function HourChart({ byHour }) {
  const [hover, setHover] = useState(null);
  const withSales = byHour.map((h, i) => (h.orders ? i : null)).filter(i => i != null);
  const first = Math.min(DEFAULT_HOURS[0], ...withSales);
  const last = Math.max(DEFAULT_HOURS[1], ...withSales);
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const max = Math.max(...hours.map(h => byHour[h].revenue), 1);

  return (
    <div className={styles.hourChart}>
      <div className={styles.columns} role="img" aria-label="Facturación por hora">
        {hours.map(h => {
          const { orders, revenue } = byHour[h];
          return (
            <div
              key={h}
              className={styles.colSlot}
              onMouseEnter={() => setHover(h)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === h && (
                <div className={styles.tooltip} role="status">
                  <strong>{h}:00 a {h + 1}:00</strong>
                  <span className="num">{formatMoney(revenue)}</span>
                  <span>{orders} {orders === 1 ? 'venta' : 'ventas'}</span>
                </div>
              )}
              <div className={`${styles.col} ${hover === h ? styles.colHover : ''}`}
                style={{ height: revenue ? `${Math.max((revenue / max) * 100, 2)}%` : 0 }} />
            </div>
          );
        })}
      </div>
      <div className={styles.axis} aria-hidden="true">
        {hours.map(h => <span key={h}>{h % 2 === 0 ? `${h}h` : ''}</span>)}
      </div>
      <table className="sr-only">
        <caption>Facturación por hora</caption>
        <tbody>
          {hours.map(h => <tr key={h}><th>{h}:00</th><td>{formatMoney(byHour[h].revenue)}</td><td>{byHour[h].orders} ventas</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

// Estadísticas de ventas confirmadas (las calcula el backend). Se refrescan
// solas cada minuto.
export default function StatsView() {
  const [range, setRange] = useState('hoy');
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { stats } = await apiFetch(`/api/feria/stats?range=${range}`);
      setStats(stats);
      setError('');
    } catch (err) {
      setError(`No se pudieron cargar las estadísticas: ${err.message}`);
    }
  }, [range]);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  const t = stats?.totals;

  return (
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <div className={styles.ranges} role="tablist" aria-label="Período">
          {RANGES.map(r => (
            <button key={r.value} type="button" role="tab" aria-selected={range === r.value}
              className={`${styles.range} ${range === r.value ? styles.rangeActive : ''}`}
              onClick={() => setRange(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={load}>Actualizar</button>
      </div>

      <Notice kind="error">{error}</Notice>

      {stats && t.orders === 0 && (
        <EmptyState title="Todavía no hay ventas confirmadas en este período">
          Las ventas cuentan cuando Caja las confirma.
        </EmptyState>
      )}

      {stats && t.orders > 0 && (
        <>
          <section className={styles.kpis}>
            <div className={`${styles.kpi} ${styles.kpiHero}`}>
              <p className={styles.kpiLabel}>Facturación</p>
              <p className={`num ${styles.kpiValue}`}>{formatMoney(t.revenue)}</p>
              <p className={styles.kpiSub}>
                Productos {formatMoney(t.productsRevenue)}{t.shippingRevenue ? ` · Envíos ${formatMoney(t.shippingRevenue)}` : ''}
              </p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Ventas</p>
              <p className={`num ${styles.kpiValue}`}>{fmtInt(t.orders)}</p>
              <p className={styles.kpiSub}>Ticket promedio {formatMoney(t.avgTicket)}</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Unidades</p>
              <p className={`num ${styles.kpiValue}`}>{fmtInt(t.units)}</p>
              <p className={styles.kpiSub}>{(t.units / t.orders).toFixed(1).replace('.', ',')} por venta</p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>Descuento por medio de pago</p>
              <p className={`num ${styles.kpiValue}`}>{formatMoney(t.discount)}</p>
              <p className={styles.kpiSub}>sobre el precio de lista</p>
            </div>
          </section>

          <section className={styles.grid}>
            <article className={styles.card}>
              <h3 className={styles.cardTitle}>Por vendedor</h3>
              <BarList
                emptyText="Sin ventas."
                rows={stats.bySeller.map(s => ({
                  key: s.name, label: s.name, value: s.revenue,
                  sub: `${s.orders} ${s.orders === 1 ? 'venta' : 'ventas'} · ${s.units} u.`,
                }))}
              />
            </article>

            <article className={styles.card}>
              <h3 className={styles.cardTitle}>Por medio de pago</h3>
              <BarList
                emptyText="Sin ventas."
                rows={stats.byPayment.map(p => ({
                  key: p.method, label: <PaymentChip method={p.method} />, value: p.revenue,
                  sub: `${p.orders} ${p.orders === 1 ? 'venta' : 'ventas'}${p.discount ? ` · descuento ${formatMoney(p.discount)}` : ''}`,
                }))}
              />
            </article>

            <article className={`${styles.card} ${styles.cardWide}`}>
              <h3 className={styles.cardTitle}>Facturación por hora</h3>
              <HourChart byHour={stats.byHour} />
            </article>

            <article className={styles.card}>
              <h3 className={styles.cardTitle}>Productos más vendidos</h3>
              <BarList
                emptyText="Sin ventas."
                rows={stats.topProducts.map(p => ({
                  key: p.sku, label: `${p.modelo} · ${p.sku}`, value: p.revenue, sub: `${p.units} u.`,
                }))}
              />
            </article>

            <article className={styles.card}>
              <h3 className={styles.cardTitle}>Por condición</h3>
              <BarList
                emptyText="Sin ventas."
                rows={Object.entries(stats.byCondition).map(([k, v]) => ({
                  key: k, label: CONDITION_LABELS[k] ?? k, value: v.revenue, sub: `${v.units} u.`,
                })).sort((a, b) => b.value - a.value)}
              />
              <h3 className={`${styles.cardTitle} ${styles.cardTitleSpaced}`}>Por forma de entrega</h3>
              <BarList
                emptyText="Sin ventas."
                rows={Object.entries(stats.byDelivery).map(([k, v]) => ({
                  key: k, label: DELIVERY_LABELS[k] ?? 'Sin dato', value: v.revenue, sub: `${v.units} u.`,
                })).sort((a, b) => b.value - a.value)}
              />
            </article>
          </section>
        </>
      )}
    </div>
  );
}
