import { useState } from 'react';
import Button from '../../components/ui/Button';
import { EMPTY_ADDRESS } from './emptyAddress';


/**
 * Shipping address fields. Controlled when `value`/`onChange` are passed (checkout,
 * where the parent owns the form); otherwise it keeps its own state and calls
 * onSubmit(address) (address book), starting from `initialValue` when editing.
 */
const AddressForm = ({ value, initialValue, onChange, onSubmit, onCancel, submitLabel = 'Save address', saving = false, showLabel = false, showDefault = false, idPrefix = 'addr' }) => {
  const [local, setLocal] = useState(value ?? initialValue ?? EMPTY_ADDRESS);
  const form = value ?? local;
  const set = (field) => (e) => {
    const next = { ...form, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value };
    if (onChange) onChange(next);
    else setLocal(next);
  };
  const id = (field) => `${idPrefix}-${field}`;

  const fields = (
    <>
      {showLabel && (
        <div className="field">
          <label htmlFor={id('label')}>Label <span className="field__optional">(optional)</span></label>
          <input id={id('label')} className="input" placeholder="Home, Office…" maxLength={50} value={form.label ?? ''} onChange={set('label')} />
        </div>
      )}
      <div className="field">
        <label htmlFor={id('name')}>Full name</label>
        <input id={id('name')} className="input" autoComplete="name" maxLength={100} value={form.full_name} onChange={set('full_name')} required />
      </div>
      <div className="field">
        <label htmlFor={id('line1')}>Street address</label>
        <input id={id('line1')} className="input" autoComplete="address-line1" placeholder="House / flat, street, area" maxLength={200} value={form.line1} onChange={set('line1')} required />
      </div>
      <div className="field">
        <label htmlFor={id('line2')}>Apartment, landmark <span className="field__optional">(optional)</span></label>
        <input id={id('line2')} className="input" autoComplete="address-line2" maxLength={200} value={form.line2 ?? ''} onChange={set('line2')} />
      </div>
      <div className="address-form__row">
        <div className="field">
          <label htmlFor={id('city')}>City</label>
          <input id={id('city')} className="input" autoComplete="address-level2" maxLength={100} value={form.city} onChange={set('city')} required />
        </div>
        <div className="field">
          <label htmlFor={id('state')}>Province / state <span className="field__optional">(optional)</span></label>
          <input id={id('state')} className="input" autoComplete="address-level1" maxLength={100} value={form.state ?? ''} onChange={set('state')} />
        </div>
      </div>
      <div className="address-form__row">
        <div className="field">
          <label htmlFor={id('postal')}>Postal code <span className="field__optional">(optional)</span></label>
          <input id={id('postal')} className="input" autoComplete="postal-code" maxLength={20} value={form.postal_code ?? ''} onChange={set('postal_code')} />
        </div>
        <div className="field">
          <label htmlFor={id('country')}>Country</label>
          <input id={id('country')} className="input" autoComplete="country-name" maxLength={100} value={form.country} onChange={set('country')} required />
        </div>
      </div>
      <div className="field">
        <label htmlFor={id('phone')}>Phone number</label>
        <input id={id('phone')} type="tel" className="input" autoComplete="tel" placeholder="For delivery updates" maxLength={30} value={form.phone} onChange={set('phone')} required />
      </div>
      {showDefault && (
        <label className="address-form__checkbox">
          <input type="checkbox" checked={Boolean(form.is_default)} onChange={set('is_default')} /> Use as my default address
        </label>
      )}
    </>
  );

  if (!onSubmit) return <div className="address-form">{fields}</div>;
  return (
    <form
      className="address-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      {fields}
      <div className="address-form__actions">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : submitLabel}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
};

export default AddressForm;
