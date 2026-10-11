import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import {
  getSettings, saveSettings, listShippingZones, createShippingZone, updateShippingZone, deleteShippingZone,
} from '../../api/admin.api';
import { errorMessage, formatMoney } from './adminUtils';

const EMPTY_ZONE = { name: '', regions: '', rate: '', free_over: '', is_default: false };

// "karachi, lahore" -> ["karachi", "lahore"]
const parseRegions = (text) => text.split(',').map((r) => r.trim()).filter(Boolean);

/** Store details, tax, alerts and returns, plus shipping zones. */
const AdminSettings = () => {
  const [settings, setSettings] = useState(null);
  const [cardEnabled, setCardEnabled] = useState(false);
  const [zones, setZones] = useState([]);
  const [zoneForm, setZoneForm] = useState(EMPTY_ZONE);
  const [editingZone, setEditingZone] = useState(null);
  const [state, setState] = useState({ saving: false, message: '', error: '' });
  const [zoneError, setZoneError] = useState('');

  const loadZones = useCallback(async () => {
    const res = await listShippingZones();
    setZones(res.data.zones);
  }, []);

  useEffect(() => {
    getSettings()
      .then((res) => {
        setSettings(res.data.settings);
        setCardEnabled(res.data.card_payments_enabled);
      })
      .catch((err) => setState((s) => ({ ...s, error: errorMessage(err, 'Could not load settings') })));
    loadZones().catch(() => {});
  }, [loadZones]);

  const set = (field) => (e) => setSettings((s) => ({ ...s, [field]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setState({ saving: true, message: '', error: '' });
    try {
      const res = await saveSettings({
        ...settings,
        tax_rate: Number(settings.tax_rate),
        low_stock_threshold: Number(settings.low_stock_threshold),
        return_window_days: Number(settings.return_window_days),
        commission_rate: Number(settings.commission_rate),
      });
      setSettings(res.data.settings);
      setState({ saving: false, message: 'Settings saved.', error: '' });
    } catch (err) {
      setState({ saving: false, message: '', error: errorMessage(err, 'Could not save settings') });
    }
  };

  const saveZone = async (e) => {
    e.preventDefault();
    setZoneError('');
    const payload = {
      name: zoneForm.name,
      regions: parseRegions(zoneForm.regions),
      rate: Number(zoneForm.rate),
      free_over: zoneForm.free_over === '' ? null : Number(zoneForm.free_over),
      is_default: zoneForm.is_default,
    };
    try {
      if (editingZone) await updateShippingZone(editingZone, payload);
      else await createShippingZone(payload);
      setZoneForm(EMPTY_ZONE);
      setEditingZone(null);
      await loadZones();
    } catch (err) {
      setZoneError(errorMessage(err, 'Could not save the zone'));
    }
  };

  if (!settings) return state.error ? <p className="form-alert form-alert-error">{state.error}</p> : <div className="skeleton" style={{ height: 240 }} />;

  return (
    <div className="admin-panel">
      <form className="card admin-editor" onSubmit={save}>
        <h2>Store</h2>
        <div className="admin-form">
          <div className="field">
            <label htmlFor="s-name">Store name</label>
            <input id="s-name" className="input" maxLength={100} value={settings.store_name} onChange={set('store_name')} />
          </div>
          <div className="field">
            <label htmlFor="s-email">Store email (on receipts)</label>
            <input id="s-email" className="input" type="email" maxLength={255} value={settings.store_email} onChange={set('store_email')} />
          </div>
          <div className="field">
            <label htmlFor="s-currency">Currency</label>
            <input id="s-currency" className="input" maxLength={3} value={settings.currency} onChange={set('currency')} />
          </div>
          <div className="field admin-form__wide">
            <label htmlFor="s-address">Store address (on receipts)</label>
            <textarea id="s-address" className="input admin-form__textarea" rows={2} maxLength={500} value={settings.store_address} onChange={set('store_address')} />
          </div>
          <div className="field">
            <label htmlFor="s-tax">Tax rate (%)</label>
            <input id="s-tax" className="input" type="number" min="0" max="50" step="0.01" value={settings.tax_rate} onChange={set('tax_rate')} />
          </div>
          <div className="field">
            <label htmlFor="s-returns">Return window (days, 0 = no returns)</label>
            <input id="s-returns" className="input" type="number" min="0" max="365" step="1" value={settings.return_window_days} onChange={set('return_window_days')} />
          </div>
          <div className="field">
            <label htmlFor="s-commission">Marketplace commission (%)</label>
            <input id="s-commission" className="input" type="number" min="0" max="90" step="0.01" value={settings.commission_rate} onChange={set('commission_rate')} />
          </div>
          <div className="field">
            <label htmlFor="s-low">Low-stock alert at</label>
            <input id="s-low" className="input" type="number" min="0" step="1" value={settings.low_stock_threshold} onChange={set('low_stock_threshold')} />
          </div>
          <div className="field admin-form__wide">
            <label htmlFor="s-alert">Low-stock alerts go to</label>
            <input id="s-alert" className="input" type="email" placeholder="Empty = every admin" maxLength={255} value={settings.alert_email} onChange={set('alert_email')} />
          </div>
          {state.error && <p className="form-alert form-alert-error admin-form__wide">{state.error}</p>}
          {state.message && <p className="form-alert form-alert-success admin-form__wide">{state.message}</p>}
          <div className="admin-form__actions admin-form__wide">
            <Button type="submit" disabled={state.saving}>{state.saving ? 'Saving…' : 'Save settings'}</Button>
          </div>
        </div>
        <p className="admin-muted">
          Card payments are {cardEnabled ? 'on' : 'off'}. They're switched on by STRIPE_SECRET_KEY in the API's .env file.
        </p>
      </form>

      <div className="card admin-editor">
        <h2>Shipping zones</h2>
        <p className="admin-muted">
          An address uses the first zone that lists its city, province or country; otherwise the default zone. With no zones, shipping is free.
        </p>
        {zones.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th scope="col">Zone</th><th scope="col">Regions</th><th scope="col" className="is-num">Rate</th><th scope="col" className="is-num">Free over</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id}>
                    <td>{z.name} {z.is_default && <span className="badge badge-secondary">default</span>}</td>
                    <td className="admin-muted">{z.regions.length ? z.regions.join(', ') : '—'}</td>
                    <td className="is-num">{formatMoney(z.rate)}</td>
                    <td className="is-num">{z.free_over ? formatMoney(z.free_over) : '—'}</td>
                    <td className="admin-row-actions">
                      <Button size="sm" variant="ghost" onClick={() => { setEditingZone(z.id); setZoneForm({ name: z.name, regions: z.regions.join(', '), rate: String(z.rate), free_over: z.free_over ?? '', is_default: z.is_default }); }}>Edit</Button>
                      <Button size="sm" variant="ghost" className="admin-danger" onClick={() => window.confirm(`Delete zone "${z.name}"?`) && deleteShippingZone(z.id).then(loadZones)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="admin-form" onSubmit={saveZone}>
          <div className="field">
            <label htmlFor="z-name">{editingZone ? 'Edit zone' : 'New zone'}</label>
            <input id="z-name" className="input" placeholder="Karachi" maxLength={100} value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="z-rate">Rate ($)</label>
            <input id="z-rate" className="input" type="number" min="0" step="0.01" value={zoneForm.rate} onChange={(e) => setZoneForm({ ...zoneForm, rate: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="z-free">Free over ($)</label>
            <input id="z-free" className="input" type="number" min="0" step="0.01" placeholder="Never free" value={zoneForm.free_over} onChange={(e) => setZoneForm({ ...zoneForm, free_over: e.target.value })} />
          </div>
          <div className="field admin-form__wide">
            <label htmlFor="z-regions">Cities, provinces or countries (comma-separated)</label>
            <input id="z-regions" className="input" placeholder="Karachi, Hyderabad, Sindh" value={zoneForm.regions} onChange={(e) => setZoneForm({ ...zoneForm, regions: e.target.value })} />
          </div>
          <label className="admin-form__checkbox">
            <input type="checkbox" checked={zoneForm.is_default} onChange={(e) => setZoneForm({ ...zoneForm, is_default: e.target.checked })} /> Default zone (everywhere else)
          </label>
          {zoneError && <p className="form-alert form-alert-error admin-form__wide">{zoneError}</p>}
          <div className="admin-form__actions admin-form__wide">
            <Button type="submit" variant="ghost">{editingZone ? 'Save zone' : 'Add zone'}</Button>
            {editingZone && <Button type="button" variant="ghost" onClick={() => { setEditingZone(null); setZoneForm(EMPTY_ZONE); }}>Cancel</Button>}
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminSettings;
