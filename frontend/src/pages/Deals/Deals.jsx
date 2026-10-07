import { useEffect, useState } from 'react';
import ProductGrid from '../../components/ui/ProductGrid';
import { getProducts } from '../../api/products.api';
import { mapProductForCard } from '../../utils/product';
import '../Wishlist/Wishlist.css';

/** /deals — everything with a live sale (its own, or its category's). */
const Deals = () => {
  const [status, setStatus] = useState('loading');
  const [products, setProducts] = useState([]);

  useEffect(() => {
    let alive = true;
    getProducts({ onSale: 'true', limit: 48, sortBy: 'price', order: 'asc' })
      .then((res) => {
        if (!alive) return;
        const rows = (res?.data?.products ?? []).map(mapProductForCard);
        setProducts(rows);
        setStatus(rows.length ? 'ready' : 'empty');
      })
      .catch(() => alive && setStatus('error'));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="listing-page container">
      <div className="section-heading">
        <span className="badge">Deals</span>
        <h2>On sale right now.</h2>
        <p className="listing-page__lead">Limited-time prices. When they're gone, they're gone.</p>
      </div>
      <ProductGrid
        status={status}
        products={products}
        emptyMessage="No sales running right now. Check back soon."
        errorMessage="Couldn't load deals. Make sure the API is running."
      />
    </div>
  );
};

export default Deals;
