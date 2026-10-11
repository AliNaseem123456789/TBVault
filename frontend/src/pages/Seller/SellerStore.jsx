import { useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import { getMySeller, updateMySeller } from '../../api/marketplace.api';
import { useAuth } from '../../features/auth/AuthProvider';
import { errorMessage } from '../Admin/adminUtils';

/** Store name and description shown on the public store page. */
const SellerStore = () => {
  const { refreshUser } = useAuth();
  const [form, setForm] = useState(null);
  const [state, setState] = useState({ saving: false, message: '', error: '' });

  useEffect(() => {
    getMySeller()
      .then((res) => setForm({ store_name: res.data.seller.store_name, description: res.data.seller.description ?? '' }))
      .catch((err) => setState((s) => ({ ...s, error: errorMessage(err, 'Could not load your store') })));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setState({ saving: true, message: '', error: '' });
    try {
      await updateMySeller({ store_name: form.store_name, description: form.description });
      await refreshUser?.();
      setState({ saving: false, message: 'Store updated.', error: '' });
    } catch (err) {
      setState({ saving: false, message: '', error: errorMessage(err, 'Could not save') });
    }
  };

  if (!form) return state.error ? <p className="form-alert form-alert-error">{state.error}</p> : <div className="skeleton" style={{ height: 160 }} />;
  return (
    <form className="card admin-editor admin-form" onSubmit={save}>
      <div className="field admin-form__wide">
        <label htmlFor="st-name">Store name</label>
        <input id="st-name" className="input" minLength={2} maxLength={100} value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} required />
      </div>
      <div className="field admin-form__wide">
        <label htmlFor="st-desc">About your store</label>
        <textarea id="st-desc" className="input admin-form__textarea" rows={5} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      {state.error && <p className="form-alert form-alert-error admin-form__wide">{state.error}</p>}
      {state.message && <p className="form-alert form-alert-success admin-form__wide">{state.message}</p>}
      <div className="admin-form__actions admin-form__wide">
        <Button type="submit" disabled={state.saving}>{state.saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
};

export default SellerStore;
