import { useEffect, useState } from 'react';
import Reveal from '../../../components/ui/Reveal';
import ProductGrid from '../../../components/ui/ProductGrid';
import Button from '../../../components/ui/Button';
import { getProducts } from '../../../api/products.api';
import { mapProductForCard } from '../../../utils/product';

const TrendingProducts = () => {
  const [status, setStatus] = useState('loading'); // loading | ready | empty | error
  const [products, setProducts] = useState([]);

  useEffect(() => {
    let cancelled = false;

    getProducts({ limit: 8, sortBy: 'created_at', order: 'desc' })
      .then((res) => {
        if (cancelled) return;
        const rows = (res?.data?.products ?? []).filter((p) => !p.is_hidden);
        setProducts(rows.map(mapProductForCard));
        setStatus(rows.length === 0 ? 'empty' : 'ready');
      })
      .catch((err) => {
        console.error('Failed to load products:', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="section trending container">
      <Reveal className="section-heading trending__heading">
        <div>
          <span className="badge badge-secondary">Trending now</span>
          <h2>People can't stop buying these.</h2>
        </div>
        <Button to="/shop" variant="ghost">
          View all products
        </Button>
      </Reveal>

      <ProductGrid
        status={status}
        products={products}
        stagger
        emptyMessage="No products yet — add some from the admin API and they'll show up here automatically."
        errorMessage="Couldn't reach the product catalog right now. Make sure the API is running — this section will fill in automatically once it responds."
      />
    </section>
  );
};

export default TrendingProducts;
