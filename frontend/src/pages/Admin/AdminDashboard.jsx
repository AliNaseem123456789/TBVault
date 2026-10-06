import { useCallback, useEffect, useState } from 'react';
import { getCategories } from '../../api/categories.api';
import AdminProducts from './AdminProducts';
import AdminCategories from './AdminCategories';
import AdminOrders from './AdminOrders';
import './Admin.css';

const TABS = [
  { id: 'orders', label: 'Orders' },
  { id: 'products', label: 'Products' },
  { id: 'categories', label: 'Categories' },
];

/** /admin — only reachable with role ADMIN (ProtectedRoute in App.jsx, requireAdmin on the API). */
const AdminDashboard = () => {
  const [tab, setTab] = useState('orders');
  const [categories, setCategories] = useState([]);

  // Categories are shared by the Products tab (dropdown) and the Categories tab.
  const loadCategories = useCallback(async () => {
    try {
      const res = await getCategories();
      setCategories(res.data ?? []);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  return (
    <div className="admin-page container">
      <div className="admin-page__header">
        <span className="badge badge-secondary">Admin</span>
        <h1>Store dashboard</h1>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`admin-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'orders' && <AdminOrders />}
        {tab === 'products' && <AdminProducts categories={categories} />}
        {tab === 'categories' && <AdminCategories categories={categories} onChange={loadCategories} />}
      </div>
    </div>
  );
};

export default AdminDashboard;
