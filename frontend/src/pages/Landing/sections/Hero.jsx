import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import Reveal from '../../../components/ui/Reveal';

const Hero = () => {
  return (
    <section className="hero container">
      <Reveal className="hero__copy">
        <span className="badge">New season, new drops</span>
        <h1 className="hero__title">
          Shop the things
          <br />
          that actually last.
        </h1>
        <p className="hero__subtitle">
          Curated electronics, home essentials and everyday carry — vetted for
          quality, priced fairly, delivered fast.
        </p>
        <div className="hero__actions">
          <Button to="/shop" size="lg">
            Shop now <Icon name="arrowRight" size={16} />
          </Button>
          <Button to="/shop" variant="ghost" size="lg">
            Browse categories
          </Button>
        </div>
        <div className="hero__stats">
          <div>
            <strong>50k+</strong>
            <span>happy customers</span>
          </div>
          <div>
            <strong>4.9/5</strong>
            <span>average rating</span>
          </div>
          <div>
            <strong>30-day</strong>
            <span>free returns</span>
          </div>
        </div>
      </Reveal>

      <Reveal delay={2} className="hero__art" aria-hidden="true">
        <div className="hero__card hero__card--1">
          <span className="badge">Best seller</span>
        </div>
        <div className="hero__card hero__card--2" />
        <div className="hero__card hero__card--3" />
      </Reveal>
    </section>
  );
};

export default Hero;
