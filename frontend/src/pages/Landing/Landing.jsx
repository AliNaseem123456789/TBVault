import Hero from './sections/Hero';
import TrustBar from './sections/TrustBar';
import Categories from './sections/Categories';
import TrendingProducts from './sections/TrendingProducts';
import PromoStrip from './sections/PromoStrip';
import Testimonials from './sections/Testimonials';
import './Landing.css';

/**
 * Public homepage. Composed entirely of section components in
 * ./sections/ — each one is a self-contained, reusable slice
 * (Hero, TrustBar, Categories, ...). To change the order of the
 * page, reorder these lines; to add a new section, build it in
 * ./sections/ and drop it in here.
 */
const Landing = () => {
  return (
    <>
      <Hero />
      <TrustBar />
      <Categories />
      <TrendingProducts />
      <PromoStrip />
      <Testimonials />
    </>
  );
};

export default Landing;
