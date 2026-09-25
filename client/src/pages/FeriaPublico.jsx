import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import { formatMoney } from '../lib/feriaLabels.js';
import logo from '../assets/logo-altorancho.png';
import { ProductPhoto, ConditionChip } from '../components/ui.jsx';
import styles from './FeriaPublico.module.css';

const SEARCH_MIN_CHARS = 6;
// Mismas claves que PUBLIC_PRICE_OPTIONS del backend.
const PRICE_TONES = { transferencia: 'transfer', efectivo: 'cash', mercadopago: 'mp' };

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

  const typed = query.trim().length;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <img src={logo} alt="Alto Rancho" className={styles.logo} />
        <h1 className={styles.title}>feria outlet.</h1>
        <p className={styles.subtitle}>Buscá el producto y mirá su precio según cómo pagues.</p>
      </header>

      <div className={styles.searchBar}>
        <label className="sr-only" htmlFor="q">Buscar producto</label>
        <input
          id="q"
          className={styles.search}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Código de la etiqueta o nombre del producto"
          autoComplete="off"
          autoFocus
        />
        <p className={styles.hint}>
          {typed > 0 && typed < SEARCH_MIN_CHARS && `Escribí ${SEARCH_MIN_CHARS - typed} caracteres más para buscar.`}
          {searching && 'Buscando…'}
          {!searching && typed >= SEARCH_MIN_CHARS && results.length === 0 && `No encontramos productos para “${query}”.`}
        </p>
      </div>

      <main className={styles.results}>
        {results.map(p => (
          <article key={p.sku} className={styles.card}>
            <div className={styles.cardPhoto}><ProductPhoto sku={p.sku} alt={p.modelo} fill /></div>
            <h2 className={styles.cardTitle}>{p.modelo}</h2>
            <p className={styles.cardSku}>{p.sku}{p.color ? ` · ${p.color.trim()}` : ''}</p>
            <div className={styles.conditions}>
              {Object.entries(p.precios).map(([condition, precios]) => (
                <section key={condition} className={`${styles.condition} cond-${condition}`}>
                  <h3 className={styles.conditionTitle}><ConditionChip condition={condition} large /></h3>
                  <ul className={styles.prices}>
                    {Object.entries(precios).map(([key, info]) => (
                      <li key={key} className={`${styles.price} ${styles[`tone-${PRICE_TONES[key]}`] ?? ''}`}>
                        <span className={styles.priceLabel}>{info.label}</span>
                        <span className={`num ${styles.priceValue}`}>{formatMoney(info.precio)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}
