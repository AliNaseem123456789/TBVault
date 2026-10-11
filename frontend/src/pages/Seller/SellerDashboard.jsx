import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getCategories } from '../../api/categories.api';
import { getBrands } from '../../api/marketplace.api';
import { sellerCatalog } from '../../api/catalog.api';
import { useAuth } from '../../features/auth/AuthProvider';
import { CatalogApiContext } from '../Admin/catalogContext';
import AdminProducts from '../Admin/AdminProducts';
import SellerOverview from './SellerOverview';
import SellerOrders from './SellerOrders';
import SellerEarnings from './SellerEarnings';
import SellerStore from './SellerStore';
import '../Admin/Admin.css';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'products', label: 'Products' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'store', label: 'Store' },
];

/**
 * /seller — an approved seller's own dashboard (ProtectedRoute + isSeller in App.jsx;
 * every /seller API call is checked against the seller account on the server).
 * The Products tab is the admin product screen pointed at the seller API.
 */
const SellerDashboard = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);

  const loadLists = useCallback(async () => {
    try {
      const [c, b] = await Promise.all([getCategories(), getBrands()]);
      setCategories(c.data ?? []);
      setBrands(b.data.brands ?? []);
    } catch (err) {
      console.error('Failed to load categories/brands:', err);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  return (
    <div className="admin-page container">
      <div className="admin-page__header">
        <span className="badge badge-secondary">Seller</span>
        <h1>{user?.seller?.store_name ?? 'Your store'}</h1>
        {user?.seller?.slug && <Link to={`/stores/${user.seller.slug}`} className="admin-muted">View your store page</Link>}
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Seller sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`admin-tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => setSearchParams({ tab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'overview' && <SellerOverview onOpenTab={(id) => setSearchParams({ tab: id })} />}
        {tab === 'orders' && <SellerOrders />}
        {tab === 'products' && (
          <CatalogApiContext.Provider value={sellerCatalog}>
            <AdminProducts categories={categories} brands={brands} />
          </CatalogApiContext.Provider>
        )}
        {tab === 'earnings' && <SellerEarnings />}
        {tab === 'store' && <SellerStore />}
      </div>
    </div>
  );
};

export default SellerDashboard;
