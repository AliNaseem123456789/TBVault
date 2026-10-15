import Button from '../../../components/ui/Button';
import Reveal from '../../../components/ui/Reveal';

/** Two advert banners side by side: the Deals page and selling on TBVault. */
const PromoBanners = () => (
  <section className="section container">
    <div className="promo-banners">
      <Reveal className="promo-banner promo-banner--ink">
        <div>
          <span className="promo-banner__eyebrow">Limited time</span>
          <h3>This week's deals, from every store.</h3>
          <p>Live sales gathered on one page, updated as sellers add them.</p>
        </div>
        <Button to="/deals">Shop deals</Button>
      </Reveal>
      <Reveal delay={2} className="promo-banner promo-banner--green">
        <div>
          <span className="promo-banner__eyebrow">For sellers</span>
          <h3>Open your store on TBVault.</h3>
          <p>List products, ship your orders and get paid. We handle checkout.</p>
        </div>
        <Button to="/sell" variant="light">Start selling</Button>
      </Reveal>
    </div>
  </section>
);

export default PromoBanners;
