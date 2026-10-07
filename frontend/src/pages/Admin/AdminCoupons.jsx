import { Fragment, useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import {
  listCoupons, createCoupon, updateCoupon, setCouponActive, deleteCoupon, getCouponRedemptions,
} from '../../api/admin.api';
import { errorMessage, formatMoney, toLocalInput, fromLocalInput } from './adminUtils';
import { formatOrderDate } from '../../utils/order';

const STATE_BADGE = { live: 'badge-secondary', scheduled: '', paused: 'badge-muted', expired: 'badge-muted', used_up: 'badge-muted' };
const STATE_TEXT = { live: 'live', scheduled: 'scheduled', paused: 'paused', expired: 'expired', used_up: 'used up' };
const EMPTY = { code: '', description: '', type: 'PERCENT', value: '10', max_discount: '', min_order_amount: '', starts_at: '', expires_at: '', usage_limit: '', per_user_limit: '' };

const describe = (c) =>
  c.type === 'PERCENT' ? `${Number(c.value)}% off${c.max_discount ? ` (max ${formatMoney(c.max_discount)})` : ''}`
    : c.type === 'FIXED' ? `${formatMoney(c.value)} off` : 'Free shipping';

/** Create, pause and track coupon codes. */
const AdminCoupons = () => {
  const [coupons, setCoupons] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [usage, setUsage] = useState(null); // { couponId, redemptions }
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listCoupons();
      setCoupons(res.data.coupons);
    } catch (err) {
      setError(errorMessage(err, 'Could not load coupons'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const n = (v) => (v === '' ? null : Number(v));
    const payload = {
      code: form.code,
      description: form.description || null,
      type: form.type,
      ...(form.type !== 'FREE_SHIPPING' ? { value: Number(form.value) } : {}),
      max_discount: form.type === 'PERCENT' ? n(form.max_discount) : null,
      min_order_amount: n(form.min_order_amount),
      starts_at: fromLocalInput(form.starts_at),
      expires_at: fromLocalInput(form.expires_at),
      usage_limit: n(form.usage_limit),
      per_user_limit: n(form.per_user_limit),
    };
    try {
      if (editingId) await updateCoupon(editingId, payload);
      else await createCoupon(payload);
      setForm(EMPTY);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the coupon'));
    } finally {
      setSaving(false);
    }
  };

  const edit = (c) => {
    setEditingId(c.id);
    const s = (v) => (v === null || v === undefined ? '' : String(v));
    setForm({
      code: c.code, description: c.description ?? '', type: c.type, value: s(Number(c.value)), max_discount: s(c.max_discount),
      min_order_amount: s(c.min_order_amount), starts_at: toLocalInput(c.starts_at), expires_at: toLocalInput(c.expires_at),
      usage_limit: s(c.usage_limit), per_user_limit: s(c.per_user_limit),
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

  const toggleUsage = async (couponId) => {
    if (usage?.couponId === couponId) {
      setUsage(null);
      return;
    }
    try {
      const res = await getCouponRedemptions(couponId);
      setUsage({ couponId, redemptions: res.data.redemptions });
    } catch (err) {
      setError(errorMessage(err, 'Could not load usage'));
    }
  };

  return (
    <div className="admin-panel">
      <form className="card admin-editor" onSubmit={submit}>
        <h2>{editingId ? 'Edit coupon' : 'New coupon'}</h2>
        <div className="admin-form">
          <div className="field">
            <label htmlFor="c-code">Code</label>
            <input id="c-code" className="input admin-input-upper" placeholder="SUMMER10" maxLength={40} pattern="[A-Za-z0-9_\-]{3,40}" value={form.code} onChange={set('code')} required />
          </div>
          <div className="field">
            <label htmlFor="c-type">Type</label>
            <select id="c-type" className="input" value={form.type} onChange={set('type')}>
              <option value="PERCENT">Percent off</option>
              <option value="FIXED">Fixed amount off</option>
              <option value="FREE_SHIPPING">Free shipping</option>
            </select>
          </div>
          {form.type !== 'FREE_SHIPPING' && (
            <div className="field">
              <label htmlFor="c-value">{form.type === 'PERCENT' ? 'Percent' : 'Amount ($)'}</label>
              <input id="c-value" className="input" type="number" min="0.01" max={form.type === 'PERCENT' ? 100 : undefined} step="0.01" value={form.value} onChange={set('value')} required />
            </div>
          )}
          {form.type === 'PERCENT' && (
            <div className="field">
              <label htmlFor="c-max">Max discount ($)</label>
              <input id="c-max" className="input" type="number" min="0" step="0.01" placeholder="No cap" value={form.max_discount} onChange={set('max_discount')} />
            </div>
          )}
          <div className="field">
            <label htmlFor="c-min">Minimum order ($)</label>
            <input id="c-min" className="input" type="number" min="0" step="0.01" placeholder="None" value={form.min_order_amount} onChange={set('min_order_amount')} />
          </div>
          <div className="field">
            <label htmlFor="c-limit">Total uses</label>
            <input id="c-limit" className="input" type="number" min="1" step="1" placeholder="Unlimited" value={form.usage_limit} onChange={set('usage_limit')} />
          </div>
          <div className="field">
            <label htmlFor="c-peruser">Uses per customer</label>
            <input id="c-peruser" className="input" type="number" min="1" step="1" placeholder="Unlimited" value={form.per_user_limit} onChange={set('per_user_limit')} />
          </div>
          <div className="field">
            <label htmlFor="c-start">Starts</label>
            <input id="c-start" className="input" type="datetime-local" value={form.starts_at} onChange={set('starts_at')} />
          </div>
          <div className="field">
            <label htmlFor="c-end">Expires</label>
            <input id="c-end" className="input" type="datetime-local" value={form.expires_at} onChange={set('expires_at')} />
          </div>
          <div className="field admin-form__wide">
            <label htmlFor="c-desc">Description (shown at checkout)</label>
            <input id="c-desc" className="input" maxLength={255} placeholder="10% off your first order" value={form.description} onChange={set('description')} />
          </div>
          {error && <p className="form-alert form-alert-error admin-form__wide">{error}</p>}
          <div className="admin-form__actions admin-form__wide">
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save coupon' : 'Create coupon'}</Button>
            {editingId && <Button type="button" variant="ghost" onClick={() => { setEditingId(null); setForm(EMPTY); }}>Cancel</Button>}
          </div>
        </div>
      </form>

      {coupons.length > 0 && (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr><th scope="col">Code</th><th scope="col">Discount</th><th scope="col" className="is-num">Used</th><th scope="col" className="is-num">Given away</th><th scope="col">Expires</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td><strong>{c.code}</strong>{c.description && <div className="admin-muted">{c.description}</div>}</td>
                    <td>{describe(c)}{c.min_order_amount && <div className="admin-muted">min {formatMoney(c.min_order_amount)}</div>}</td>
                    <td className="is-num">{c.times_used}{c.usage_limit ? ` / ${c.usage_limit}` : ''}</td>
                    <td className="is-num">{formatMoney(c.total_discount)}</td>
                    <td>{c.expires_at ? formatOrderDate(c.expires_at) : '—'}</td>
                    <td><span className={`badge ${STATE_BADGE[c.state]}`}>{STATE_TEXT[c.state]}</span></td>
                    <td className="admin-row-actions">
                      <Button size="sm" variant="ghost" onClick={() => toggleUsage(c.id)}>Usage</Button>
                      <Button size="sm" variant="ghost" onClick={() => edit(c)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(() => setCouponActive(c.id, !c.is_active))}>{c.is_active ? 'Pause' : 'Resume'}</Button>
                      {c.times_used === 0 && (
                        <Button size="sm" variant="ghost" className="admin-danger" onClick={() => window.confirm(`Delete ${c.code}?`) && act(() => deleteCoupon(c.id))}>Delete</Button>
                      )}
                    </td>
                  </tr>
                  {usage?.couponId === c.id && (
                    <tr className="admin-table__detail">
                      <td colSpan={7}>
                        {usage.redemptions.length === 0 ? (
                          <p className="admin-muted">Not used yet.</p>
                        ) : (
                          <ul>
                            {usage.redemptions.map((r) => (
                              <li key={r.id}>
                                Order #{r.order.id} · {r.email} · −{formatMoney(r.discount_amount)} · {formatOrderDate(r.created_at)} · {r.order.status}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminCoupons;
