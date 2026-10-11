import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import { useCatalogApi } from './catalogContext';
import { errorMessage } from './adminUtils';

const EMPTY = { name: '', sku: '', price: '', stock: '0' };

// One editable row. Keeps its own draft so typing doesn't re-render the whole list.
const VariantRow = ({ variant, basePrice, onSave, onDelete }) => {
  const [draft, setDraft] = useState({
    name: variant.name,
    sku: variant.sku ?? '',
    price: variant.price ?? '',
    stock: String(variant.stock),
    is_active: variant.is_active,
  });
  const [saving, setSaving] = useState(false);
  const dirty =
    draft.name !== variant.name || draft.sku !== (variant.sku ?? '') || String(draft.price) !== String(variant.price ?? '') ||
    draft.stock !== String(variant.stock) || draft.is_active !== variant.is_active;
  const set = (field) => (e) => setDraft((d) => ({ ...d, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <tr className={variant.is_active ? '' : 'is-muted'}>
      <td><input className="input admin-cell-input" value={draft.name} onChange={set('name')} maxLength={100} aria-label="Option name" /></td>
      <td><input className="input admin-cell-input" value={draft.sku} onChange={set('sku')} maxLength={64} aria-label="SKU" /></td>
      <td><input className="input admin-cell-input" type="number" min="0" step="0.01" placeholder={String(basePrice)} value={draft.price} onChange={set('price')} aria-label="Price" /></td>
      <td><input className="input admin-cell-input" type="number" min="0" step="1" value={draft.stock} onChange={set('stock')} aria-label="Stock" /></td>
      <td><input type="checkbox" checked={draft.is_active} onChange={set('is_active')} aria-label="Active" /></td>
      <td className="admin-row-actions">
        <Button
          size="sm"
          variant="ghost"
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            await onSave(variant.id, { name: draft.name, sku: draft.sku || null, price: draft.price === '' ? null : Number(draft.price), stock: Number(draft.stock), is_active: draft.is_active });
            setSaving(false);
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" className="admin-danger" onClick={() => onDelete(variant)}>Delete</Button>
      </td>
    </tr>
  );
};

/**
 * Options for one product (size, colour…). Once a product has an active option,
 * customers must pick one and stock/price come from the option; leave price
 * empty to use the product's price.
 */
const VariantsEditor = ({ productId, basePrice, onChange }) => {
  const { listVariants, createVariant, updateVariant, deleteVariant } = useCatalogApi();
  const [variants, setVariants] = useState([]);
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listVariants(productId);
      setVariants(res.data.variants);
    } catch (err) {
      setError(errorMessage(err, 'Could not load options'));
    }
  }, [productId, listVariants]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn) => {
    setError('');
    try {
      await fn();
      await load();
      onChange?.();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'));
    }
  };

  const add = async (e) => {
    e.preventDefault();
    setAdding(true);
    await act(async () => {
      await createVariant(productId, {
        name: draft.name,
        sku: draft.sku || null,
        price: draft.price === '' ? null : Number(draft.price),
        stock: Number(draft.stock),
        sort_order: variants.length + 1,
      });
      setDraft(EMPTY);
    });
    setAdding(false);
  };

  return (
    <div className="admin-images">
      <div className="admin-images__header">
        <h3>Options</h3>
      </div>
      <p className="admin-muted">
        Sizes, colours and so on. With at least one active option, customers must choose one and the product's own stock isn't used.
      </p>
      {error && <p className="form-alert form-alert-error">{error}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Name</th><th scope="col">SKU</th><th scope="col">Price ($)</th><th scope="col">Stock</th><th scope="col">Active</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <VariantRow
                key={`${v.id}-${v.updated_at}`}
                variant={v}
                basePrice={basePrice}
                onSave={(id, data) => act(() => updateVariant(id, data))}
                onDelete={(variant) => window.confirm(`Delete option "${variant.name}"?`) && act(() => deleteVariant(variant.id))}
              />
            ))}
            <tr className="admin-table__new">
              <td><input className="input admin-cell-input" placeholder="e.g. Black / M" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={100} aria-label="New option name" form="variant-new" required /></td>
              <td><input className="input admin-cell-input" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} maxLength={64} aria-label="New option SKU" form="variant-new" /></td>
              <td><input className="input admin-cell-input" type="number" min="0" step="0.01" placeholder={String(basePrice)} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} aria-label="New option price" form="variant-new" /></td>
              <td><input className="input admin-cell-input" type="number" min="0" step="1" value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: e.target.value })} aria-label="New option stock" form="variant-new" /></td>
              <td />
              <td className="admin-row-actions">
                <form id="variant-new" onSubmit={add}>
                  <Button type="submit" size="sm" disabled={adding}>{adding ? 'Adding…' : 'Add option'}</Button>
                </form>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default VariantsEditor;
