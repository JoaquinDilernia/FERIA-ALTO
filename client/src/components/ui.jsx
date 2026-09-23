import logoAlto from '../assets/logo-alto.png';
import logoAltorancho from '../assets/logo-altorancho.png';
import { LINE_STATUS, ORDER_STATUS, paymentMethodInfo } from '../lib/feriaLabels.js';
import styles from './ui.module.css';

export function logout() {
  localStorage.removeItem('feria_token');
  localStorage.removeItem('feria_role');
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
