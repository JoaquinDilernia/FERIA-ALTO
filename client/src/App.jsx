import { Routes, Route, Navigate } from 'react-router-dom';
import VendedorLogin from './pages/VendedorLogin.jsx';
import VendedorPanel from './pages/VendedorPanel.jsx';
import CajaLogin from './pages/CajaLogin.jsx';
import CajaPanel from './pages/CajaPanel.jsx';
import FeriaPublico from './pages/FeriaPublico.jsx';
import LogisticaPanel from './pages/LogisticaPanel.jsx';

function hasSession(role) {
  return localStorage.getItem('feria_token') && localStorage.getItem('feria_role') === role;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/vendedor" replace />} />
      <Route path="/vendedor" element={hasSession('vendedor') ? <VendedorPanel /> : <VendedorLogin />} />
      <Route path="/caja" element={hasSession('caja') ? <CajaPanel /> : <CajaLogin />} />
      <Route path="/logistica" element={hasSession('caja') ? <LogisticaPanel /> : <CajaLogin />} />
      <Route path="/feria" element={<FeriaPublico />} />
    </Routes>
  );
}
