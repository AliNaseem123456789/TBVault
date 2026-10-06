import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Reveal from '../../../components/ui/Reveal';
import { getCategories } from '../../../api/categories.api';

// Placeholder art only cycles through 4 tones until categories have
// their own imagery.
const TONES = 4;

const mapCategory = (category, index) => ({
  id: category.id,
  name: category.name,
  count: category.productCount ?? category._count?.products, // present only if the API adds it later
  tone: (index % TONES) + 1,
});

const Categories = () => {
  const [status, setStatus] = useState('loading'); // loading | ready | empty | error
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    let cancelled = false;

    getCategories()
      .then((res) => {
        if (cancelled) return;
        const rows = res?.data ?? [];
        if (rows.length === 0) {
          setStatus('empty');
          return;
        }
        setCategories(rows.map(mapCategory));
        setStatus('ready');
      })
      .catch((err) => {
        console.error('Failed to load categories:', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'empty') return null; // nothing to show yet — don't render an empty section

  return (
    <section className="section categories container">
      <Reveal className="section-heading">
        <span className="badge">Shop by category</span>
        <h2>Find your next favorite thing.</h2>
      </Reveal>

      {status === 'loading' && (
        <div className="categories__grid" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton category-skeleton" />
          ))}
        </div>
      )}

      {status === 'ready' && (
        <div className="categories__grid">
          {categories.map((cat, i) => (
            <Reveal key={cat.id} delay={(i % 4) + 1}>
              <Link to={`/shop?categoryId=${cat.id}`} className={`category-card category-card--${cat.tone} card card-hover`}>
                {typeof cat.count === 'number' && <span className="category-card__count">{cat.count} items</span>}
                <h3>{cat.name}</h3>
              </Link>
            </Reveal>
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="trending__placeholder card">
          <p>Couldn't load categories right now — make sure the API is running.</p>
        </div>
      )}
    </section>
  );
};

export default Categories;
