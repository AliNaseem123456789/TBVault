import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCategories } from '../../api/categories.api';
import AdminOverview from './AdminOverview';
import AdminProducts from './AdminProducts';
import AdminCategories from './AdminCategories';
import AdminOrders from './AdminOrders';
import AdminSales from './AdminSales';
import AdminCoupons from './AdminCoupons';
import AdminReturns from './AdminReturns';
import AdminCustomers from './AdminCustomers';
import AdminReviews from './AdminReviews';
import AdminSettings from './AdminSettings';
import AdminSellers from './AdminSellers';
import AdminBrands from './AdminBrands';
import AdminGiftCards from './AdminGiftCards';
import { getBrands } from '../../api/marketplace.api';
import './Admin.css';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'returns', label: 'Returns' },
  { id: 'products', label: 'Products' },
  { id: 'sellers', label: 'Sellers' },
  { id: 'categories', label: 'Categories' },
  { id: 'brands', label: 'Brands' },
  { id: 'sales', label: 'Sales' },
  { id: 'coupons', label: 'Coupons' },
  { id: 'customers', label: 'Customers' },
  { id: 'gift-cards', label: 'Gift cards' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'settings', label: 'Settings' },
];

/** /admin — only reachable with role ADMIN (ProtectedRoute in App.jsx, requireAdmin on the API). */
const AdminDashboard = () => {
  // The tab lives in the URL (?tab=orders) so a refresh or a shared link opens the same tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);

  // Categories are shared by the Products, Sales and Categories tabs.
  const loadCategories = useCallback(async () => {
    try {
      const res = await getCategories();
      setCategories(res.data ?? []);
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }, []);

  // Brands are shared by the Products and Brands tabs.
  const loadBrands = useCallback(async () => {
    try {
      const res = await getBrands();
      setBrands(res.data.brands ?? []);
    } catch (err) {
      console.error('Failed to load brands:', err);
    }
  }, []);

  useEffect(() => {
    loadCategories();
    loadBrands();
  }, [loadCategories, loadBrands]);

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
            onClick={() => setSearchParams({ tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'overview' && <AdminOverview />}
        {tab === 'orders' && <AdminOrders />}
        {tab === 'returns' && <AdminReturns />}
        {tab === 'products' && <AdminProducts categories={categories} brands={brands} showSeller />}
        {tab === 'sellers' && <AdminSellers />}
        {tab === 'categories' && <AdminCategories categories={categories} onChange={loadCategories} />}
        {tab === 'brands' && <AdminBrands brands={brands} onChange={loadBrands} />}
        {tab === 'sales' && <AdminSales categories={categories} />}
        {tab === 'coupons' && <AdminCoupons />}
        {tab === 'customers' && <AdminCustomers />}
        {tab === 'gift-cards' && <AdminGiftCards />}
        {tab === 'reviews' && <AdminReviews />}
        {tab === 'settings' && <AdminSettings />}
      </div>
    </div>
  );
};

export default AdminDashboard;
