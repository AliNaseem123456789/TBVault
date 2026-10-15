import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../../components/ui/Icon';
import Reveal from '../../../components/ui/Reveal';
import { getCategories } from '../../../api/categories.api';
import { getImageUrl } from '../../../utils/product';

const SHOWN = 6; // one row on desktop

/**
 * One row of the biggest categories. Each tile shows the photo of the category's
 * newest product (the API sends it as image_key), or its first letter when no
 * product in it has a photo yet. Empty categories are left out.
 */
const Categories = () => {
  const [status, setStatus] = useState('loading'); // loading | ready | empty | error
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getCategories()
      .then((res) => {
        if (cancelled) return;
        const rows = (res?.data ?? [])
          .filter((c) => (c._count?.products ?? 0) > 0)
          .sort((a, b) => b._count.products - a._count.products)
          .slice(0, SHOWN);
        setCategories(rows);
        setStatus(rows.length ? 'ready' : 'empty');
      })
      .catch((err) => {
        console.error('Failed to load categories:', err);
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'empty' || status === 'error') return null;

  return (
    <section className="section container landing-categories">
      <Reveal className="landing-heading">
        <h2>Shop by category</h2>
        <Link to="/shop" className="landing-heading__link">
          All categories <Icon name="arrowRight" size={14} />
        </Link>
      </Reveal>

      <div className="landing-categories__row">
        {status === 'loading'
          ? Array.from({ length: SHOWN }).map((_, i) => (
              <div key={i} className="landing-category" aria-hidden="true">
                <div className="skeleton landing-category__photo" />
                <div className="skeleton landing-category__skeleton-label" />
              </div>
            ))
          : categories.map((cat, i) => (
              <Reveal key={cat.id} delay={(i % 4) + 1}>
                <Link to={`/shop?categoryId=${cat.id}`} className="landing-category">
                  <span className="landing-category__photo">
                    {cat.image_key ? (
                      <img src={getImageUrl(cat.image_key)} alt="" loading="lazy" />
                    ) : (
                      <span className="landing-category__initial" aria-hidden="true">{cat.name.charAt(0)}</span>
                    )}
                  </span>
                  <span className="landing-category__name">{cat.name}</span>
                  <span className="landing-category__count">{cat._count.products} {cat._count.products === 1 ? 'item' : 'items'}</span>
                </Link>
              </Reveal>
            ))}
      </div>
    </section>
  );
};

export default Categories;
