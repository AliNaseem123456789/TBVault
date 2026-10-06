import Marquee from '../../../components/ui/Marquee';
import Button from '../../../components/ui/Button';
import Reveal from '../../../components/ui/Reveal';

const ITEMS = [
  '20% off your first order',
  'Free returns within 30 days',
  'New drops every Friday',
  'Members ship free',
];

const PromoStrip = () => (
  <section className="promo-strip">
    <Marquee items={ITEMS} tone="ink" />
    <Reveal className="promo-strip__banner container">
      <div>
        <h2>Get 20% off your first order.</h2>
        <p>Create a free account and we'll email you a code instantly.</p>
      </div>
      <Button to="/sign-up" variant="light" size="lg">
        Create account
      </Button>
    </Reveal>
  </section>
);

export default PromoStrip;
