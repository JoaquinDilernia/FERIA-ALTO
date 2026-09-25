import { useState } from 'react';
import { BASE_URL } from '../lib/api.js';
import { clearSession } from '../lib/session.js';
import logoAlto from '../assets/logo-alto.png';
import logoAltorancho from '../assets/logo-altorancho.png';
import { LINE_STATUS, ORDER_STATUS, CONDITION_LABELS, paymentMethodInfo, formatMoney } from '../lib/feriaLabels.js';
import styles from './ui.module.css';

export function logout() {
  clearSession();
  window.location.reload();
}

// Encabezado de todos los paneles: logo reducido, nombre del panel en
// minúscula con punto (como la marca), pestañas opcionales y salir.
export function AppHeader({ panel, userName, tabs, activeTab, onTabChange }) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <img src={logoAlto} alt="Alto Rancho" className={styles.brandLogo} />
        <span className={styles.panelName}>{panel}.</span>
      </div>
      {tabs && (
        <nav className={styles.tabs} aria-label="Secciones">
          {tabs.map(t => (
            <button
              key={t.value}
              type="button"
              className={`${styles.tab} ${activeTab === t.value ? styles.tabActive : ''}`}
              aria-current={activeTab === t.value ? 'page' : undefined}
              onClick={() => onTabChange(t.value)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}
      <div className={styles.headerEnd}>
        {userName && <span className={styles.userName}>{userName}</span>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>Salir</button>
      </div>
    </header>
  );
}

export function Chip({ tone = 'neutral', large = false, children }) {
  return <span className={`${styles.chip} ${large ? styles.chipLg : ''} ${styles[`tone-${tone}`]}`}>{children}</span>;
}

export function LineStatusChip({ status, large }) {
  const meta = LINE_STATUS[status];
  if (!meta) return null;
  return <Chip tone={meta.tone} large={large}>{meta.label}</Chip>;
}

export function OrderStatusChip({ status, large }) {
  const meta = ORDER_STATUS[status] ?? { label: status, tone: 'neutral' };
  return <Chip tone={meta.tone} large={large}>{meta.label}</Chip>;
}

export function PaymentChip({ method, large }) {
  const info = paymentMethodInfo(method);
  return (
    <Chip tone={info.tone} large={large}>
      {info.label}{info.discountPct > 0 ? ` −${info.discountPct}%` : ''}
    </Chip>
  );
}

// Cómo se paga el pedido: un chip por medio, con su monto si el pago está
// dividido (a Odoo va solo el principal, order.paymentMethod).
export function PaymentChips({ order, large }) {
  if (!order.payments?.length) return <PaymentChip method={order.paymentMethod} large={large} />;
  return order.payments.map(p => (
    <Chip key={p.method} tone={paymentMethodInfo(p.method).tone} large={large}>
      {paymentMethodInfo(p.method).label} {formatMoney(p.amount)}
    </Chip>
  ));
}

// Número interno (F-0012) y, una vez confirmado, el del pedido en Odoo.
// Los pedidos viejos sin número muestran el comienzo de su id.
export function OrderNumbers({ order, large }) {
  return (
    <span className={styles.orderNumbers}>
      <span className={`${styles.orderNumber} ${large ? styles.orderNumberLg : ''}`}>
        {order.number ?? `#${order.id.slice(0, 6)}`}
      </span>
      {order.odooOrderName && <Chip tone="neutral">Odoo {order.odooOrderName}</Chip>}
      {order.invoiceName && <Chip tone="neutral">{order.invoiceName}</Chip>}
    </span>
  );
}

export function Notice({ kind = 'info', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`${styles.notice} ${styles[`notice-${kind}`]}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onClose && <button type="button" className={styles.noticeClose} onClick={onClose} aria-label="Cerrar aviso">×</button>}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children && <p>{children}</p>}
    </div>
  );
}

export function LoginShell({ title, hint, onSubmit, children }) {
  return (
    <div className={styles.loginPage}>
      <form className={styles.loginCard} onSubmit={onSubmit}>
        <img src={logoAltorancho} alt="Alto Rancho" className={styles.loginLogo} />
        <h1 className={styles.loginTitle}>{title}</h1>
        {hint && <p className={styles.loginHint}>{hint}</p>}
        {children}
      </form>
    </div>
  );
}

export const uiStyles = styles;

// Foto cuadrada del producto (la de Odoo, servida por el backend). Si no
// tiene foto, un recuadro neutro del mismo tamaño para que las listas no
// salten. `size` en px; con `fill` ocupa el ancho del contenedor.
export function ProductPhoto({ sku, alt = '', size = 64, fill = false }) {
  const [failed, setFailed] = useState(false);
  const box = fill ? undefined : { width: size, height: size };
  if (failed || !sku) {
    return (
      <span className={`${styles.photo} ${styles.photoEmpty} ${fill ? styles.photoFill : ''}`} style={box} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="40%" height="40%" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.8" />
          <path d="M21 16l-5-5-8 8" />
        </svg>
      </span>
    );
  }
  return (
    <img
      className={`${styles.photo} ${fill ? styles.photoFill : ''}`}
      style={box}
      src={`${BASE_URL}/api/feria/products/${encodeURIComponent(sku)}/image`}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

// Falla en rojo, discontinuo en gris azulado (ver --falla / --disc).
export function ConditionChip({ condition, large = false }) {
  return (
    <span className={`${styles.condition} ${large ? styles.conditionLg : ''} cond-${condition}`}>
      {CONDITION_LABELS[condition] ?? condition}
    </span>
  );
}
