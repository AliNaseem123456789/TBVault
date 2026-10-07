import { useState } from 'react';
import Button from '../../components/ui/Button';

/**
 * Pick which delivered items to send back and why. `remaining` maps order item
 * id -> how many can still be returned (ordered minus already in a return).
 */
const ReturnRequestForm = ({ order, remaining, onSubmit, onCancel }) => {
  const returnable = (order.items ?? []).filter((i) => (remaining[i.id] ?? 0) > 0);
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');
  const [state, setState] = useState({ sending: false, error: '' });

  const chosen = Object.entries(quantities).filter(([, q]) => q > 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!chosen.length) {
      setState({ sending: false, error: 'Choose at least one item' });
      return;
    }
    setState({ sending: true, error: '' });
    try {
      await onSubmit({ reason, items: chosen.map(([id, quantity]) => ({ order_item_id: Number(id), quantity })) });
    } catch (err) {
      setState({ sending: false, error: err?.response?.data?.message || 'Could not request the return' });
    }
  };

  return (
    <form className="return-form" onSubmit={submit}>
      <ul className="return-form__items">
        {returnable.map((item) => (
          <li key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={(quantities[item.id] ?? 0) > 0}
                onChange={(e) => setQuantities((q) => ({ ...q, [item.id]: e.target.checked ? 1 : 0 }))}
              />
              <span>{item.product_name ?? item.product?.name}{item.variant_name ? ` (${item.variant_name})` : ''}</span>
            </label>
            {(quantities[item.id] ?? 0) > 0 && remaining[item.id] > 1 && (
              <select
                className="input return-form__qty"
                value={quantities[item.id]}
                onChange={(e) => setQuantities((q) => ({ ...q, [item.id]: Number(e.target.value) }))}
                aria-label="Quantity to return"
              >
                {Array.from({ length: remaining[item.id] }, (_, n) => n + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </li>
        ))}
      </ul>
      <div className="field">
        <label htmlFor="return-reason">Why are you returning it?</label>
        <textarea id="return-reason" className="input" rows={3} minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} required />
      </div>
      {state.error && <p className="form-alert form-alert-error">{state.error}</p>}
      <div className="return-form__actions">
        <Button type="submit" disabled={state.sending}>{state.sending ? 'Sending…' : 'Request return'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
};

export default ReturnRequestForm;
