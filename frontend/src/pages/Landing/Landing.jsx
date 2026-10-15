import Hero from './sections/Hero';
import TrustBar from './sections/TrustBar';
import Categories from './sections/Categories';
import ProductTabs from './sections/ProductTabs';
import PromoBanners from './sections/PromoBanners';
import WhyTBVault from './sections/WhyTBVault';
import CreditStrip from './sections/CreditStrip';
import Testimonials from './sections/Testimonials';
import NewsletterBand from './sections/NewsletterBand';
import { useProductList } from './useProductList';
import './Landing.css';

const BEST_SELLERS = { sortBy: 'best_selling', limit: 8 };

/**
 * Public homepage, built from the section components in ./sections/.
 * Best sellers are loaded once here and shared: the hero rotates the top
 * ones, the product tabs show them first, and "Why TBVault" uses their photos.
 * To reorder the page, reorder these lines.
 */
const Landing = () => {
  const bestSellers = useProductList(BEST_SELLERS);
  return (
    <div className="landing">
      <Hero products={bestSellers.products} />
      <TrustBar />
      <Categories />
      <ProductTabs bestSellers={bestSellers} />
      <PromoBanners />
      <WhyTBVault products={bestSellers.products} />
      <CreditStrip />
      <Testimonials />
      <NewsletterBand />
    </div>
  );
};

export default Landing;
