import EntregasView from '../components/EntregasView.jsx';
import styles from './CajaPanel.module.css';

function logout() {
  localStorage.removeItem('feria_token');
  localStorage.removeItem('feria_role');
  window.location.reload();
}

// Mismo login que caja (rol 'caja'): para la feria no hace falta un rol
// aparte, y así el admin en caja puede resolver cualquier cosa desde acá.
export default function LogisticaPanel() {
  return (
    <div className={styles.page}>
      <nav className={styles.tabs}>
        <span className={`${styles.tabBtn} ${styles.tabBtnActive}`}>Logística</span>
        <button type="button" className={styles.logoutBtn} onClick={logout}>Salir</button>
      </nav>
      <EntregasView initialFilter="mandar_feria" />
    </div>
  );
}
