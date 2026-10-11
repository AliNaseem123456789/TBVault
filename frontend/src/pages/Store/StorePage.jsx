import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import ProductGrid from '../../components/ui/ProductGrid';
import { getStore } from '../../api/marketplace.api';
import { getProducts } from '../../api/products.api';
import { mapProductForCard } from '../../utils/product';
import '../Wishlist/Wishlist.css';
import './StorePage.css';

/** /stores/:slug — one seller's storefront. */
const StorePage = () => {
  const { slug } = useParams();
  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    getStore(slug)
      .then(async (res) => {
        if (!alive) return;
        const s = res.data.store;
        setStore(s);
        const list = await getProducts({ sellerId: s.id, limit: 48 });
        if (!alive) return;
        const rows = (list?.data?.products ?? []).map(mapProductForCard);
        setProducts(rows);
        setStatus(rows.length ? 'ready' : 'empty');
      })
      .catch(() => alive && setStatus('missing'));
    return () => {
      alive = false;
    };
  }, [slug]);

  if (status === 'missing') {
    return (
      <div className="listing-page container">
        <div className="section-heading">
          <h2>Store not found.</h2>
          <p className="listing-page__lead">It may have closed or the link is wrong.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="listing-page container">
      <div className="section-heading store-header">
        <span className="badge"><Icon name="store" size={14} /> {store?.is_platform ? 'Official store' : 'Marketplace seller'}</span>
        <h2>{store?.store_name ?? ' '}</h2>
        {store?.description && <p className="listing-page__lead store-header__about">{store.description}</p>}
        {store && (
          <p className="store-header__meta">
            {store._count.products} product{store._count.products === 1 ? '' : 's'}
            {store.rating?.count > 0 && ` · ★ ${Number(store.rating.average).toFixed(1)} from ${store.rating.count} review${store.rating.count === 1 ? '' : 's'}`}
          </p>
        )}
      </div>
      <ProductGrid status={status} products={products} emptyMessage="No products in this store yet." errorMessage="Couldn't load this store." />
    </div>
  );
};

export default StorePage;
