import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import { CONDITION_LABELS, formatMoney, defaultDeliveryFor, defaultLocationFor, hasDiscontinuoStock } from '../lib/feriaLabels.js';
import { Chip, ProductPhoto } from './ui.jsx';
import styles from './AddProductSearch.module.css';

const SEARCH_MIN_CHARS = 4;

// Buscador para que Caja sume un producto a un pedido sin confirmar. El
// precio final lo calcula el servidor con el medio de pago del pedido; acá
// solo se elige producto, condición y de dónde sale (se ajusta después en la
// línea, como cualquier otra).
export default function AddProductSearch({ disabled, onAdd, onClose }) {
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
        const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(value)}`);
        setResults(products);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function add(product, condition) {
    const location = defaultLocationFor(condition, product.stock);
    onAdd({ sku: product.sku, condition, qty: 1, location, delivery: defaultDeliveryFor(location), modelo: product.modelo });
    setQuery('');
    setResults([]);
  }

  const typed = query.trim().length;

  return (
    <section className={styles.box}>
      <div className={styles.head}>
        <label className={styles.title} htmlFor="add-product">Agregar producto al pedido</label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
      </div>
      <input
        id="add-product"
        className="input"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="SKU o modelo, mínimo 4 caracteres"
        autoComplete="off"
        autoFocus
      />
      {searching && <p className={styles.hint}>Buscando…</p>}
      {!searching && typed >= SEARCH_MIN_CHARS && results.length === 0 && (
        <p className={styles.hint}>No hay productos de la feria que coincidan.</p>
      )}
      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map(p => {
            const sinStock = !hasDiscontinuoStock(p.stock);
            return (
              <li key={p.sku} className={styles.result}>
                <ProductPhoto sku={p.sku} alt={p.modelo} size={56} />
                <div className={styles.info}>
                  <p className={styles.name}>{p.modelo}</p>
                  <p className={styles.meta}>{p.sku}</p>
                  <div className={styles.stock}>
                    {p.stock ? (
                      <>
                        <span className={styles.stockLabel}>Stock discontinuo</span>
                        <Chip tone={p.stock.exhibicion > 0 ? 'done' : 'neutral'}>Exhibición {p.stock.exhibicion}</Chip>
                        <Chip tone={p.stock.rolon > 0 ? 'done' : 'neutral'}>Rolón {p.stock.rolon}</Chip>
                      </>
                    ) : <Chip tone="removed">Stock no disponible</Chip>}
                  </div>
                </div>
                <div className={styles.buttons}>
                  {['falla', 'discontinuo'].map(condition => p.condiciones[condition].disponible && (
                    <button key={condition} type="button" className={`btn btn-sm ${styles.condBtn} cond-${condition}`}
                      disabled={disabled || (condition === 'discontinuo' && sinStock)} onClick={() => add(p, condition)}>
                      <span className={styles.condName}>{CONDITION_LABELS[condition]}</span> <span className="num">{formatMoney(p.condiciones[condition].precioTabla)}</span>
                    </button>
                  ))}
                  {sinStock && p.stock && p.condiciones.discontinuo.disponible && <span className={styles.noStock}>Discontinuo sin stock</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
