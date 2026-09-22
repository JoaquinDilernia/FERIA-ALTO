import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './FeriaPublico.module.css';

const SEARCH_MIN_CHARS = 6;
const CONDITION_LABELS = { falla: 'Falla', discontinuo: 'Discontinuo' };

export default function FeriaPublico() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef(null);

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
        const { products } = await apiFetch(`/api/feria/public/products/search?q=${encodeURIComponent(value)}`);
        setResults(products);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  return (
    <div className={styles.page}>
      <img src="/src/assets/ALTORANCHO.png" alt="Alto Rancho" className={styles.logo} />
      <h1 className={styles.title}>Feria Outlet — Consultá tu precio</h1>
      <input
        className={styles.input}
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Buscá por SKU o modelo (mínimo 6 caracteres)"
        autoFocus
      />
      {searching && <p className={styles.hint}>Buscando...</p>}
      {!searching && query.trim().length >= SEARCH_MIN_CHARS && results.length === 0 && (
        <p className={styles.hint}>No encontramos ningún producto para "{query}".</p>
      )}

      <div className={styles.results}>
        {results.map(p => (
          <div key={p.sku} className={styles.card}>
            <h2 className={styles.cardTitle}>{p.modelo}</h2>
            <p className={styles.cardSku}>SKU: {p.sku}{p.color ? ` · ${p.color}` : ''}</p>
            {Object.entries(p.precios).map(([condition, precios]) => (
              <div key={condition} className={styles.conditionBlock}>
                <h3 className={styles.conditionTitle}>{CONDITION_LABELS[condition]}</h3>
                <table className={styles.priceTable}>
                  <tbody>
                    {Object.entries(precios).map(([method, info]) => (
                      <tr key={method}>
                        <td>{info.label}</td>
                        <td className={styles.price}>${info.precio}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
