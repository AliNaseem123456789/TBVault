import { Link } from 'react-router-dom';
import Icon from '../../../components/ui/Icon';
import Reveal from '../../../components/ui/Reveal';

const POINTS = ['Secure card checkout with Stripe', 'Store credit for one-tap checkout', 'Back-in-stock alerts by email'];

/**
 * Image beside text. The image side is a collage of up to three real product
 * photos (best sellers); without photos it shows a calm brand panel instead.
 */
const WhyTBVault = ({ products = [] }) => {
  const photos = products.filter((p) => p.imageUrl).slice(0, 3);
  return (
    <section className="section container">
      <div className="why">
        <Reveal className={`why__art why__art--${photos.length}`}>
          {photos.length ? (
            photos.map((p) => (
              <Link key={p.id} to={`/products/${p.id}`} className="why__photo" aria-label={p.name}>
                <img src={p.imageUrl} alt="" loading="lazy" />
              </Link>
            ))
          ) : (
            <span className="why__mark" aria-hidden="true"><Icon name="store" size={56} /></span>
          )}
        </Reveal>
        <Reveal delay={2} className="why__copy">
          <span className="landing-eyebrow">Why TBVault</span>
          <h2>One cart, many trusted stores.</h2>
          <p>
            Every seller is approved before they can list. Pay once by card or cash on delivery, and follow each
            package from your order page.
          </p>
          <ul className="why__points">
            {POINTS.map((point) => (
              <li key={point}>
                <Icon name="check" size={18} /> {point}
              </li>
            ))}
          </ul>
          <Link to="/about" className="why__link">About TBVault</Link>
        </Reveal>
      </div>
    </section>
  );
};

export default WhyTBVault;
