import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import { getImageUrl } from '../../utils/product';
import { listProducts } from '../../api/admin.api';
import ProductEditor from './ProductEditor';
import { errorMessage, formatMoney } from './adminUtils';

const PAGE_SIZE = 20;

const AdminProducts = ({ categories }) => {
  const [products, setProducts] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  // null = list only, 'new' = creating, number = editing that product
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (query) params.search = query;
      const res = await listProducts(params);
      setProducts(res.data.products);
      setMeta(res.metaData);
      setStatus('ready');
    } catch (err) {
      setError(errorMessage(err, 'Could not load products'));
      setStatus('error');
    }
  }, [page, query]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setQuery(search.trim());
  };

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <form className="admin-search" onSubmit={handleSearch}>
          <input
            className="input"
            placeholder="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search products"
          />
          <Button type="submit" variant="ghost" size="sm">
            <Icon name="search" size={16} /> Search
          </Button>
        </form>
        <Button size="sm" onClick={() => setEditing('new')} disabled={categories.length === 0}>
          New product
        </Button>
      </div>
      {categories.length === 0 && <p className="admin-muted">Create a category first, then you can add products.</p>}

      {editing !== null && (
        <ProductEditor
          key={editing}
          productId={editing === 'new' ? null : editing}
          categories={categories}
          onSaved={load}
          onDeleted={() => {
            setEditing(null);
            load();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {status === 'error' && <p className="form-alert form-alert-error">{error}</p>}
      {status === 'loading' && <div className="skeleton" style={{ height: 200 }} />}
      {status === 'ready' && products.length === 0 && <p className="admin-muted">No products found.</p>}

      {products.length > 0 && (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Category</th>
                <th scope="col" className="is-num">Price</th>
                <th scope="col" className="is-num">Stock</th>
                <th scope="col">Visibility</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={editing === p.id ? 'is-selected' : ''}>
                  <td>
                    <div className="admin-table__product">
                      <span className="admin-thumb">
                        {p.images?.[0] ? <img src={getImageUrl(p.images[0].key)} alt="" /> : <Icon name="image" size={16} />}
                      </span>
                      {p.name}
                    </div>
                  </td>
                  <td>{p.category?.name}</td>
                  <td className="is-num">{formatMoney(p.price)}</td>
                  <td className={`is-num ${p.stock === 0 ? 'admin-danger' : ''}`}>{p.stock}</td>
                  <td>{p.is_hidden ? <span className="badge badge-muted">Hidden</span> : <span className="badge badge-secondary">Live</span>}</td>
                  <td className="is-num">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(p.id)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="admin-pager">
          <Button variant="ghost" size="sm" disabled={!meta.hasPrev} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {meta.currentPage} of {meta.totalPages}
          </span>
          <Button variant="ghost" size="sm" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
};

export default AdminProducts;
