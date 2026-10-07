import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import { listSales, createSale, updateSale, deleteSale, listProducts } from '../../api/admin.api';
import { errorMessage, toLocalInput, fromLocalInput } from './adminUtils';

const STATE_BADGE = { live: 'badge-secondary', scheduled: '', paused: 'badge-muted', ended: 'badge-muted' };

const emptyForm = () => {
  const now = new Date();
  return { name: '', percent_off: '10', target: 'category', category_id: '', product_id: '', starts_at: toLocalInput(now), ends_at: toLocalInput(new Date(now.getTime() + 7 * 86400000)) };
};

/** Timed % discounts on a product or a whole category, shown as struck-through prices. */
const AdminSales = ({ categories }) => {
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listSales();
      setSales(res.data.sales);
    } catch (err) {
      setError(errorMessage(err, 'Could not load sales'));
    }
  }, []);

  useEffect(() => {
    load();
    listProducts({ limit: 100, sortBy: 'name', order: 'asc' }).then((res) => setProducts(res.data.products)).catch(() => {});
  }, [load]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      name: form.name,
      percent_off: Number(form.percent_off),
      product_id: form.target === 'product' ? Number(form.product_id) : null,
      category_id: form.target === 'category' ? Number(form.category_id) : null,
      starts_at: fromLocalInput(form.starts_at),
      ends_at: fromLocalInput(form.ends_at),
    };
    try {
      if (editingId) await updateSale(editingId, payload);
      else await createSale(payload);
      setForm(emptyForm());
      setEditingId(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the sale'));
    } finally {
      setSaving(false);
    }
  };

  const edit = (s) => {
    setEditingId(s.id);
    setForm({
      name: s.name, percent_off: String(s.percent_off), target: s.product_id ? 'product' : 'category',
      category_id: s.category_id ? String(s.category_id) : '', product_id: s.product_id ? String(s.product_id) : '',
      starts_at: toLocalInput(s.starts_at), ends_at: toLocalInput(s.ends_at),
    });
  };

  const act = async (fn) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'));
    }
  };

  return (
    <div className="admin-panel">
      <form className="card admin-editor" onSubmit={submit}>
        <h2>{editingId ? 'Edit sale' : 'New sale'}</h2>
        <div className="admin-form">
          <div className="field">
            <label htmlFor="sale-name">Name</label>
            <input id="sale-name" className="input" placeholder="Summer sale" maxLength={100} value={form.name} onChange={set('name')} required />
          </div>
          <div className="field">
            <label htmlFor="sale-pct">Percent off</label>
            <input id="sale-pct" className="input" type="number" min="1" max="90" step="1" value={form.percent_off} onChange={set('percent_off')} required />
          </div>
          <div className="field">
            <label htmlFor="sale-target">Applies to</label>
            <select id="sale-target" className="input" value={form.target} onChange={set('target')}>
              <option value="category">A category</option>
              <option value="product">One product</option>
            </select>
          </div>
          {form.target === 'category' ? (
            <div className="field">
              <label htmlFor="sale-cat">Category</label>
              <select id="sale-cat" className="input" value={form.category_id} onChange={set('category_id')} required>
                <option value="" disabled>Choose…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="sale-product">Product</label>
              <select id="sale-product" className="input" value={form.product_id} onChange={set('product_id')} required>
                <option value="" disabled>Choose…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="sale-start">Starts</label>
            <input id="sale-start" className="input" type="datetime-local" value={form.starts_at} onChange={set('starts_at')} required />
          </div>
          <div className="field">
            <label htmlFor="sale-end">Ends</label>
            <input id="sale-end" className="input" type="datetime-local" value={form.ends_at} onChange={set('ends_at')} required />
          </div>
          {error && <p className="form-alert form-alert-error admin-form__wide">{error}</p>}
          <div className="admin-form__actions admin-form__wide">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save sale' : 'Create sale'}</Button>
            {editingId && <Button type="button" variant="ghost" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>Cancel</Button>}
          </div>
        </div>
        <p className="admin-muted">When a product is in more than one live sale, the biggest discount wins. Past orders keep the price they were charged.</p>
      </form>

      {sales.length > 0 && (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr><th scope="col">Sale</th><th scope="col">On</th><th scope="col" className="is-num">Off</th><th scope="col">When</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.product ? s.product.name : `${s.category?.name} (category)`}</td>
                  <td className="is-num">{s.percent_off}%</td>
                  <td className="admin-muted">{new Date(s.starts_at).toLocaleString()} → {new Date(s.ends_at).toLocaleString()}</td>
                  <td><span className={`badge ${STATE_BADGE[s.state]}`}>{s.state}</span></td>
                  <td className="admin-row-actions">
                    <Button size="sm" variant="ghost" onClick={() => edit(s)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => act(() => updateSale(s.id, { is_active: !s.is_active }))}>{s.is_active ? 'Pause' : 'Resume'}</Button>
                    <Button size="sm" variant="ghost" className="admin-danger" onClick={() => window.confirm(`Delete "${s.name}"?`) && act(() => deleteSale(s.id))}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminSales;
