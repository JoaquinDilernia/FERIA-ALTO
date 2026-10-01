import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import { PAYMENT_METHODS, formatMoney } from '../lib/feriaLabels.js';
import { ProductPhoto, ConditionChip, Chip, EmptyState } from './ui.jsx';
import AddLabelButton from './AddLabelButton.jsx';
import styles from './ProductLookupView.module.css';

const SEARCH_MIN_CHARS = 4;
const REBAJA_LABELS = { 1: 'Rebaja 1', 2: 'Rebaja 2', 3: 'Rebaja 3' };
// Un precio por grupo, como los ve el cliente: las tres tarjetas valen lo mismo.
const PRICE_GROUPS = [
  { label: 'Transferencia', method: 'transferencia' },
  { label: 'Efectivo', method: 'efectivo' },
  { label: 'Tarjeta', method: 'mp_debito' },
];
const pct = (method) => PAYMENT_METHODS.find(m => m.value === method).discountPct;

// Pestaña "Productos" de Caja: consultar precio vigente y stock por ubicación
// sin armar un pedido (el cliente pregunta en la caja).
export default function ProductLookupView() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const timeout = useRef(null);

  function handleChange(value) {
    setQuery(value);
    clearTimeout(timeout.current);
    if (value.trim().length < SEARCH_MIN_CHARS) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timeout.current = setTimeout(async () => {
      try {
        setResults((await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(value)}`)).products);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  const typed = query.trim().length;

  return (
    <div className={styles.body}>
      <label className={styles.label} htmlFor="product-lookup">Consultar un producto</label>
      <input id="product-lookup" className={`input ${styles.search}`} value={query} autoComplete="off" autoFocus
        placeholder="SKU o modelo, mínimo 4 caracteres" onChange={(e) => handleChange(e.target.value)} />
      {searching && <p className={styles.muted}>Buscando…</p>}
      {!searching && typed >= SEARCH_MIN_CHARS && results.length === 0 && (
        <EmptyState title="Sin resultados">No hay productos de la feria que coincidan con “{query}”.</EmptyState>
      )}

      <ul className={styles.results}>
        {results.map(p => (
          <li key={p.sku} className={styles.product}>
            <ProductPhoto sku={p.sku} alt={p.modelo} size={88} />
            <div className={styles.info}>
              <p className={styles.name}>{p.modelo}</p>
              <p className={styles.muted}>{p.sku}{p.color ? ` · ${p.color.trim()}` : ''}</p>
              <div className={styles.stock}>
                {p.stock ? (
                  <>
                    <span className={styles.muted}>Stock discontinuo disponible</span>
                    <Chip tone={p.stock.exhibicion > 0 ? 'done' : 'neutral'}>Exhibición {p.stock.exhibicion}</Chip>
                    <Chip tone={p.stock.rolon > 0 ? 'done' : 'neutral'}>Rolón {p.stock.rolon}</Chip>
                  </>
                ) : <Chip tone="removed">Stock no disponible: Odoo no responde</Chip>}
              </div>
            </div>
            <div className={styles.conditions}>
              {['falla', 'discontinuo'].map(condition => {
                const info = p.condiciones[condition];
                if (!info.disponible) return null;
                return (
                  <div key={condition} className={`${styles.condition} cond-${condition}`}>
                    <div className={styles.conditionHead}>
                      <ConditionChip condition={condition} />
                      {info.rebajaActiva > 0 && <span className={styles.rebaja}>{REBAJA_LABELS[info.rebajaActiva]}</span>}
                      <span className={`num ${styles.list}`}>Lista {formatMoney(info.precioTabla)}</span>
                    </div>
                    <dl className={styles.prices}>
                      {PRICE_GROUPS.map(g => (
                        <div key={g.method}>
                          <dt>{g.label}</dt>
                          <dd className="num">{formatMoney(Math.round(info.precioTabla * (1 - pct(g.method) / 100)))}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className={styles.labelBtn}><AddLabelButton product={p} condition={condition} /></div>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
