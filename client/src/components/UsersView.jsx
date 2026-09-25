import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api.js';
import { Notice, EmptyState, Chip } from './ui.jsx';
import styles from './UsersView.module.css';

const ADMIN_ROLES = { caja: 'Caja', logistica: 'Logística', superadmin: 'Super admin' };
const EMPTY_SELLER = { name: '', pin: '', code: '' };
const EMPTY_ADMIN = { email: '', name: '', password: '', role: 'caja' };

// Pestaña Usuarios (solo super admin): vendedores con su PIN y número (el
// prefijo de sus pedidos, F2-0001) y usuarios de caja / logística.
export default function UsersView() {
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState({ kind: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [seller, setSeller] = useState(EMPTY_SELLER);
  const [editingSeller, setEditingSeller] = useState(null); // id o null
  const [admin, setAdmin] = useState(EMPTY_ADMIN);
  const [editingAdmin, setEditingAdmin] = useState(null); // email o null

  useEffect(() => {
    apiFetch('/api/feria/users').then(setData).catch(err => setNotice({ kind: 'error', text: err.message }));
  }, []);

  async function run(path, method, body, successText) {
    setBusy(true);
    setNotice({ kind: '', text: '' });
    try {
      setData(await apiFetch(`/api/feria/users${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }));
      setNotice({ kind: 'success', text: successText });
      return true;
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveSeller(e) {
    e.preventDefault();
    const ok = editingSeller
      ? await run(`/sellers/${editingSeller}`, 'PATCH', seller, `Vendedor ${seller.name} actualizado.`)
      : await run('/sellers', 'POST', seller, `Vendedor ${seller.name} creado: sus pedidos van a ser F${seller.code}-0001, F${seller.code}-0002…`);
    if (ok) { setSeller(EMPTY_SELLER); setEditingSeller(null); }
  }

  async function saveAdmin(e) {
    e.preventDefault();
    const ok = editingAdmin
      ? await run(`/admins/${encodeURIComponent(editingAdmin)}`, 'PATCH', admin, `Usuario ${admin.email} actualizado.`)
      : await run('/admins', 'POST', admin, `Usuario ${admin.email} creado (${ADMIN_ROLES[admin.role]}).`);
    if (ok) { setAdmin(EMPTY_ADMIN); setEditingAdmin(null); }
  }

  function removeSeller(s) {
    if (!window.confirm(`¿Borrar al vendedor ${s.name}? Ya no va a poder entrar con su PIN.`)) return;
    run(`/sellers/${s.id}`, 'DELETE', null, `Vendedor ${s.name} borrado.`);
  }

  function removeAdmin(a) {
    if (!window.confirm(`¿Borrar el usuario ${a.email}? Ya no va a poder entrar.`)) return;
    run(`/admins/${encodeURIComponent(a.id)}`, 'DELETE', null, `Usuario ${a.email} borrado.`);
  }

  if (!data) {
    return <div className={styles.body}><Notice kind={notice.kind || 'info'}>{notice.text || 'Cargando usuarios…'}</Notice></div>;
  }

  return (
    <div className={styles.body}>
      <Notice kind={notice.kind || 'info'} onClose={() => setNotice({ kind: '', text: '' })}>{notice.text}</Notice>

      <section className={styles.card}>
        <h2 className={styles.title}>Vendedores</h2>
        <p className={styles.muted}>Entran a <b>/#/vendedor</b> con su PIN. El número es el prefijo de sus pedidos (el 2 → F2-0001).</p>
        {data.sellers.length === 0 ? <EmptyState title="Todavía no hay vendedores" /> : (
          <table className={styles.table}>
            <thead><tr><th>N.º</th><th>Nombre</th><th>PIN</th><th /></tr></thead>
            <tbody>
              {data.sellers.map(s => (
                <tr key={s.id}>
                  <td className="num">{s.code ? `F${s.code}` : <Chip tone="removed">Sin número</Chip>}</td>
                  <td>{s.name}{s.test && <span className={styles.muted}> · prueba</span>}</td>
                  <td className="num">{s.pin}</td>
                  <td className={styles.actions}>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                      onClick={() => { setEditingSeller(s.id); setSeller({ name: s.name, pin: s.pin, code: s.code ?? '' }); }}>Editar</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeSeller(s)}>Borrar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className={styles.form} onSubmit={saveSeller}>
          <h3 className={styles.subtitle}>{editingSeller ? 'Editar vendedor' : 'Nuevo vendedor'}</h3>
          <div className={styles.fields}>
            <label className="field"><span className="field-label">Nombre</span>
              <input className="input" value={seller.name} onChange={(e) => setSeller({ ...seller, name: e.target.value })} /></label>
            <label className={`field ${styles.narrow}`}><span className="field-label">Número</span>
              <input className="input num" inputMode="numeric" placeholder="Ej. 3" value={seller.code} onChange={(e) => setSeller({ ...seller, code: e.target.value })} /></label>
            <label className={`field ${styles.narrow}`}><span className="field-label">PIN (4 a 8 números)</span>
              <input className="input num" inputMode="numeric" value={seller.pin} onChange={(e) => setSeller({ ...seller, pin: e.target.value })} /></label>
          </div>
          <div className={styles.formActions}>
            {editingSeller && <button type="button" className="btn btn-secondary" onClick={() => { setEditingSeller(null); setSeller(EMPTY_SELLER); }}>Cancelar</button>}
            <button type="submit" className="btn btn-primary" disabled={busy}>{editingSeller ? 'Guardar cambios' : 'Crear vendedor'}</button>
          </div>
        </form>
      </section>

      <section className={styles.card}>
        <h2 className={styles.title}>Caja y Logística</h2>
        <p className={styles.muted}>Entran con email y contraseña. Caja ve todo el panel de caja; Logística, solo <b>/#/logistica</b>.</p>
        <table className={styles.table}>
          <thead><tr><th>Email</th><th>Nombre</th><th>Rol</th><th /></tr></thead>
          <tbody>
            {data.admins.map(a => (
              <tr key={a.id}>
                <td>{a.email}</td>
                <td>{a.name}{a.test && <span className={styles.muted}> · prueba</span>}</td>
                <td>{ADMIN_ROLES[a.role] ?? a.role}</td>
                <td className={styles.actions}>
                  {a.role !== 'superadmin' && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={() => { setEditingAdmin(a.id); setAdmin({ email: a.email, name: a.name ?? '', password: '', role: a.role }); }}>Editar</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeAdmin(a)}>Borrar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form className={styles.form} onSubmit={saveAdmin}>
          <h3 className={styles.subtitle}>{editingAdmin ? `Editar ${editingAdmin}` : 'Nuevo usuario'}</h3>
          <div className={styles.fields}>
            {!editingAdmin && (
              <label className="field"><span className="field-label">Email</span>
                <input className="input" type="email" autoComplete="off" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></label>
            )}
            <label className="field"><span className="field-label">Nombre</span>
              <input className="input" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} /></label>
            <label className={`field ${styles.narrow}`}><span className="field-label">Rol</span>
              <select className="select" value={admin.role} onChange={(e) => setAdmin({ ...admin, role: e.target.value })}>
                <option value="caja">Caja</option>
                <option value="logistica">Logística</option>
              </select></label>
            <label className="field"><span className="field-label">{editingAdmin ? 'Contraseña nueva (opcional)' : 'Contraseña (mín. 6)'}</span>
              <input className="input" type="password" autoComplete="new-password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} /></label>
          </div>
          <div className={styles.formActions}>
            {editingAdmin && <button type="button" className="btn btn-secondary" onClick={() => { setEditingAdmin(null); setAdmin(EMPTY_ADMIN); }}>Cancelar</button>}
            <button type="submit" className="btn btn-primary" disabled={busy}>{editingAdmin ? 'Guardar cambios' : 'Crear usuario'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
