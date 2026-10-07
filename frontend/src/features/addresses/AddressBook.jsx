import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import AddressForm from './AddressForm';
import { getAddresses, createAddress, updateAddress, setDefaultAddress, deleteAddress } from '../../api/addresses.api';
import './Addresses.css';

// Strips server fields so an address can be edited and re-sent.
const toForm = (a) => ({
  label: a.label ?? '', full_name: a.full_name, phone: a.phone, line1: a.line1, line2: a.line2 ?? '',
  city: a.city, state: a.state ?? '', postal_code: a.postal_code ?? '', country: a.country, is_default: a.is_default,
});

export const AddressSummary = ({ address }) => (
  <div className="address-summary">
    <strong>{address.full_name}</strong>
    <span>{[address.line1, address.line2].filter(Boolean).join(', ')}</span>
    <span>{[address.city, address.state, address.postal_code].filter(Boolean).join(', ')}, {address.country}</span>
    <span className="address-summary__phone">{address.phone}</span>
  </div>
);

/** Saved addresses on the profile page: add, edit, set default, delete. */
const AddressBook = () => {
  const [addresses, setAddresses] = useState([]);
  const [status, setStatus] = useState('loading');
  const [editing, setEditing] = useState(null); // null | 'new' | address id
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await getAddresses();
      setAddresses(res?.data?.addresses ?? []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (form) => {
    setSaving(true);
    setError('');
    try {
      if (editing === 'new') await createAddress(form);
      else await updateAddress(editing, form);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save this address');
    } finally {
      setSaving(false);
    }
  };

  const run = async (fn) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Something went wrong');
    }
  };

  if (status === 'loading') return <div className="skeleton" style={{ height: 120 }} />;
  if (status === 'error') return <p className="form-alert form-alert-error">Couldn't load your addresses.</p>;

  return (
    <div className="address-book">
      {error && <p className="form-alert form-alert-error">{error}</p>}
      {addresses.length === 0 && editing !== 'new' && <p className="address-book__empty">No saved addresses yet. Save one to check out faster.</p>}

      <ul className="address-book__list">
        {addresses.map((a) =>
          editing === a.id ? (
            <li key={a.id} className="address-book__item is-editing">
              <AddressForm
                idPrefix={`addr-${a.id}`}
                initialValue={toForm(a)}
                showLabel
                showDefault={!a.is_default}
                onSubmit={save}
                onCancel={() => setEditing(null)}
                saving={saving}
                submitLabel="Save changes"
              />
            </li>
          ) : (
            <li key={a.id} className="address-book__item">
              <div className="address-book__item-head">
                <span className="address-book__label">{a.label || 'Address'}</span>
                {a.is_default && <span className="badge badge-secondary">Default</span>}
              </div>
              <AddressSummary address={a} />
              <div className="address-book__actions">
                <button type="button" onClick={() => setEditing(a.id)}>Edit</button>
                {!a.is_default && <button type="button" onClick={() => run(() => setDefaultAddress(a.id))}>Make default</button>}
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => window.confirm('Delete this address?') && run(() => deleteAddress(a.id))}
                >
                  Delete
                </button>
              </div>
            </li>
          )
        )}
      </ul>

      {editing === 'new' ? (
        <div className="address-book__new">
          <AddressForm idPrefix="addr-new" showLabel showDefault onSubmit={save} onCancel={() => setEditing(null)} saving={saving} />
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setEditing('new')}>
          <Icon name="pin" size={16} /> Add an address
        </Button>
      )}
    </div>
  );
};

export default AddressBook;
