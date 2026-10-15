import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../../components/ui/Icon';
import Reveal from '../../../components/ui/Reveal';
import ProductGrid from '../../../components/ui/ProductGrid';
import { useProductList } from '../useProductList';

const TABS = [
  { id: 'best', label: 'Best sellers', href: '/best-sellers' },
  { id: 'new', label: 'New arrivals', href: '/new-arrivals', params: { sortBy: 'created_at', order: 'desc', limit: 4 } },
  { id: 'sale', label: 'On sale', href: '/deals', params: { onSale: 'true', sortBy: 'created_at', order: 'desc', limit: 4 } },
];

/**
 * "Popular right now": one row of products, switchable between best sellers
 * (loaded once by the page and shared with the hero), new arrivals and deals.
 * A tab's products are fetched the first time it's opened.
 */
const ProductTabs = ({ bestSellers }) => {
  const [active, setActive] = useState('best');
  const [opened, setOpened] = useState({ best: true });
  const newArrivals = useProductList(TABS[1].params, { skip: !opened.new });
  const onSale = useProductList(TABS[2].params, { skip: !opened.sale });
  const lists = { best: { ...bestSellers, products: bestSellers.products.slice(0, 4) }, new: newArrivals, sale: onSale };
  const tab = TABS.find((t) => t.id === active);
  const list = lists[active];

  const open = (id) => {
    setActive(id);
    setOpened((o) => ({ ...o, [id]: true }));
  };

  return (
    <section className="section container landing-tabs">
      <Reveal className="landing-heading">
        <h2>Popular right now</h2>
        <div className="landing-tabs__list" role="tablist" aria-label="Product lists">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active === t.id}
              aria-controls="landing-tab-panel"
              className={active === t.id ? 'is-active' : ''}
              onClick={() => open(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Reveal>

      <div id="landing-tab-panel" role="tabpanel" aria-labelledby={`tab-${active}`}>
        <ProductGrid
          status={list.status}
          products={list.products}
          skeletonCount={4}
          emptyMessage={active === 'sale' ? 'No deals running right now. Check back soon.' : 'No products yet.'}
          errorMessage="Couldn't load products right now. Please refresh the page."
        />
        <Link to={tab.href} className="landing-heading__link landing-tabs__more">
          See all {tab.label.toLowerCase()} <Icon name="arrowRight" size={14} />
        </Link>
      </div>
    </section>
  );
};

export default ProductTabs;
