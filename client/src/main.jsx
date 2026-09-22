import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* HashRouter a propósito: el navegador nunca manda el hash al server,
        así que cualquier host estático sirve /index.html y el ruteo funciona
        sin configurar ningún rewrite. Las URLs quedan como /#/feria. */}
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
