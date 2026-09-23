import EntregasView from '../components/EntregasView.jsx';
import { AppHeader } from '../components/ui.jsx';
import styles from './CajaPanel.module.css';

// Mismo login que caja (rol 'caja'): para la feria no hace falta un rol
// aparte, y así el admin en caja puede resolver cualquier cosa desde acá.
export default function LogisticaPanel() {
  const user = JSON.parse(localStorage.getItem('feria_user') || '{}');
  return (
    <div className={styles.page}>
      <AppHeader panel="logística" userName={user.name} />
      <EntregasView initialFilter="mandar_feria" />
    </div>
  );
}
