import { useState } from 'react';
import Button from '../../components/ui/Button';
import { createBrand, renameBrand, deleteBrand } from '../../api/marketplace.api';
import { errorMessage } from './adminUtils';

/** Brands products can be tagged with (filterable in the shop). */
const AdminBrands = ({ brands, onChange }) => {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action, fallback) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await onChange();
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (await run(() => createBrand(newName.trim()), 'Could not create the brand')) setNewName('');
  };

  const handleRename = async (e) => {
    e.preventDefault();
    if (await run(() => renameBrand(editingId, editName.trim()), 'Could not rename the brand')) setEditingId(null);
  };

  const handleDelete = (brand) => {
    if (!window.confirm(`Delete the "${brand.name}" brand? Its products keep existing, without a brand.`)) return;
    run(() => deleteBrand(brand.id), 'Could not delete the brand');
  };

  return (
    <div className="admin-panel">
      <form className="admin-toolbar admin-search" onSubmit={handleCreate}>
        <input
          className="input"
          placeholder="New brand name"
          maxLength={100}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          aria-label="New brand name"
          required
        />
        <Button type="submit" size="sm" disabled={busy}>
          Add brand
        </Button>
      </form>

      {error && <p className="form-alert form-alert-error">{error}</p>}
      {brands.length === 0 ? (
        <p className="admin-muted">No brands yet.</p>
      ) : (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="is-num">Live products</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {brands.map((c) => (
                <tr key={c.id}>
                  <td>
                    {editingId === c.id ? (
                      <form className="admin-inline-form" onSubmit={handleRename}>
                        <input className="input" value={editName} maxLength={100} onChange={(e) => setEditName(e.target.value)} aria-label="Brand name" autoFocus required />
                        <Button type="submit" size="sm" disabled={busy}>Save</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </form>
                    ) : (
                      c.name
                    )}
                  </td>
                  <td className="is-num">{c._count?.products ?? '—'}</td>
                  <td className="is-num admin-row-actions">
                    {editingId !== c.id && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => { setEditingId(c.id); setEditName(c.name); }}>
                          Rename
                        </Button>
                        <Button variant="ghost" size="sm" className="admin-danger" onClick={() => handleDelete(c)} disabled={busy}>
                          Delete
                        </Button>
                      </>
                    )}
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

export default AdminBrands;
