import { useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import { getImageUrl } from '../../utils/product';
import {
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImages,
  deleteProductImage,
  setPrimaryImage,
} from '../../api/admin.api';
import { errorMessage } from './adminUtils';

const EMPTY = { name: '', description: '', price: '', stock: '0', category_id: '', is_hidden: false };

/**
 * Create a product (productId = null) or edit an existing one.
 * Images can only be added once the product exists, so after creating
 * we switch straight into edit mode for the new id.
 */
const ProductEditor = ({ productId, categories, onSaved, onDeleted, onClose }) => {
  const [id, setId] = useState(productId);
  const [form, setForm] = useState(EMPTY);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(Boolean(productId));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async (productIdToLoad) => {
    const res = await getProduct(productIdToLoad);
    const p = res.data.product;
    setForm({
      name: p.name,
      description: p.description ?? '',
      price: String(p.price),
      stock: String(p.stock),
      category_id: String(p.category_id),
      is_hidden: p.is_hidden,
    });
    setImages(p.images ?? []);
  };

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    load(productId)
      .catch((err) => !cancelled && setError(errorMessage(err, 'Could not load this product')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    const payload = {
      name: form.name,
      description: form.description.trim() || null,
      price: Number(form.price),
      stock: Number(form.stock),
      category_id: Number(form.category_id),
      is_hidden: form.is_hidden,
    };
    try {
      if (id) {
        await updateProduct(id, payload);
        setNotice('Saved.');
      } else {
        const res = await createProduct(payload);
        setId(res.data.product.id);
        setNotice('Product created. You can add images now.');
      }
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the product'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setError('');
    try {
      await uploadProductImages(id, files);
      await load(id);
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const imageAction = async (action) => {
    setError('');
    try {
      await action();
      await load(id);
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'));
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${form.name}"? This can't be undone.`)) return;
    setError('');
    try {
      await deleteProduct(id);
      onDeleted?.();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the product'));
    }
  };

  if (loading) return <div className="card admin-editor"><div className="skeleton" style={{ height: 240 }} /></div>;

  return (
    <div className="card admin-editor">
      <div className="admin-editor__header">
        <h2>{id ? 'Edit product' : 'New product'}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <form className="admin-form" onSubmit={handleSubmit}>
        <div className="field admin-form__wide">
          <label htmlFor="p-name">Name</label>
          <input id="p-name" className="input" maxLength={100} value={form.name} onChange={update('name')} required />
        </div>
        <div className="field admin-form__wide">
          <label htmlFor="p-desc">Description</label>
          <textarea id="p-desc" className="input admin-form__textarea" rows={4} value={form.description} onChange={update('description')} />
        </div>
        <div className="field">
          <label htmlFor="p-price">Price ($)</label>
          <input id="p-price" className="input" type="number" min="0" step="0.01" value={form.price} onChange={update('price')} required />
        </div>
        <div className="field">
          <label htmlFor="p-stock">Stock</label>
          <input id="p-stock" className="input" type="number" min="0" step="1" value={form.stock} onChange={update('stock')} required />
        </div>
        <div className="field">
          <label htmlFor="p-category">Category</label>
          <select id="p-category" className="input" value={form.category_id} onChange={update('category_id')} required>
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <label className="admin-form__checkbox">
          <input type="checkbox" checked={form.is_hidden} onChange={update('is_hidden')} />
          Hidden from the shop
        </label>

        {error && <p className="form-alert form-alert-error admin-form__wide">{error}</p>}
        {notice && <p className="form-alert form-alert-success admin-form__wide">{notice}</p>}

        <div className="admin-form__actions admin-form__wide">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : id ? 'Save changes' : 'Create product'}
          </Button>
          {id && (
            <Button type="button" variant="ghost" onClick={handleDelete} className="admin-danger">
              Delete product
            </Button>
          )}
        </div>
      </form>

      {id && (
        <div className="admin-images">
          <div className="admin-images__header">
            <h3>Images</h3>
            <label className={`btn btn-ghost btn-sm ${uploading ? 'is-disabled' : ''}`}>
              <Icon name="image" size={16} /> {uploading ? 'Uploading…' : 'Add images'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden onChange={handleUpload} disabled={uploading} />
            </label>
          </div>
          <p className="admin-muted">Up to 6 at a time, 5 MB each. The primary image is shown in the shop.</p>
          {images.length === 0 ? (
            <p className="admin-muted">No images yet.</p>
          ) : (
            <ul className="admin-images__grid">
              {images.map((img) => (
                <li key={img.id} className={`admin-image ${img.is_primary ? 'is-primary' : ''}`}>
                  <img src={getImageUrl(img.key)} alt={img.original_name || ''} />
                  <div className="admin-image__actions">
                    {img.is_primary ? (
                      <span className="badge badge-secondary">Primary</span>
                    ) : (
                      <button type="button" onClick={() => imageAction(() => setPrimaryImage(id, img.id))}>
                        Make primary
                      </button>
                    )}
                    <button type="button" className="admin-danger" onClick={() => imageAction(() => deleteProductImage(id, img.id))}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductEditor;
