import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import Reveal from '../../../components/ui/Reveal';

const ROTATE_MS = 6000;

/**
 * Homepage hero: headline on the left, and on the right the store's real best
 * sellers (up to 3, those with a photo), rotating every few seconds. Product
 * photos usually have white backgrounds; `mix-blend-mode: multiply` in the CSS
 * melts that white into the peach panel. With no photos yet, a brand mark shows.
 */
const Hero = ({ products = [] }) => {
  const slides = products.filter((p) => p.imageUrl).slice(0, 3);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = slides[index % Math.max(slides.length, 1)];

  useEffect(() => {
    if (slides.length < 2 || paused) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [slides.length, paused]);

  return (
    <section className="container landing-hero-wrap">
      <div className="landing-hero" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <Reveal className="landing-hero__copy">
          <span className="landing-hero__badge">New this week</span>
          <h1 className="landing-hero__title">Everyday gear from stores you can trust.</h1>
          <p className="landing-hero__lead">
            Headphones, home essentials and everyday carry from approved sellers. Pay by card or cash on delivery.
          </p>
          <div className="landing-hero__actions">
            <Button to="/shop" size="lg">
              Shop now <Icon name="arrowRight" size={16} />
            </Button>
            <Button to="/deals" variant="ghost" size="lg">
              Today's deals
            </Button>
          </div>
          {slides.length > 1 && (
            <div className="landing-hero__dots">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={i === index ? 'is-active' : ''}
                  aria-label={`Show ${s.name}`}
                  aria-pressed={i === index}
                  onClick={() => setIndex(i)}
                />
              ))}
            </div>
          )}
        </Reveal>

        <Reveal delay={2} className="landing-hero__art">
          {current ? (
            <Link to={`/products/${current.id}`} className="landing-hero__product" aria-label={`${current.name}, ${current.pricePrefix}$${current.price}`}>
              <img key={current.id} src={current.imageUrl} alt="" className="landing-hero__photo" />
              <span className="landing-hero__chip" aria-hidden="true">
                <span className="landing-hero__chip-label">Best seller</span>
                <strong>{current.name}</strong>
                <span>
                  {current.pricePrefix}${current.price}
                  {current.oldPrice && <s>${current.oldPrice}</s>}
                </span>
              </span>
            </Link>
          ) : (
            <div className="landing-hero__mark" aria-hidden="true">
              TB<span>Vault</span>
            </div>
          )}
        </Reveal>
      </div>
    </section>
  );
};

export default Hero;
