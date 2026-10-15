import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../../components/ui/Icon';
import Reveal from '../../../components/ui/Reveal';
import { getFeaturedReviews } from '../../../api/reviews.api';

/**
 * Real 4-5 star reviews from verified buyers (GET /reviews/featured).
 * The section renders nothing until there are reviews to show, so the
 * landing page never displays made-up quotes.
 */
const Testimonials = () => {
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getFeaturedReviews(3)
      .then((res) => {
        if (!cancelled) setReviews(res?.data?.reviews ?? []);
      })
      .catch((err) => console.error('Failed to load featured reviews:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  if (reviews.length === 0) return null;

  return (
    <section className="section container testimonials">
      <Reveal className="landing-heading">
        <h2>What shoppers say</h2>
      </Reveal>
      <div className="testimonials__grid">
        {reviews.map((r, i) => {
          const name = r.user?.name || 'Customer';
          return (
            <Reveal key={r.id} delay={(i % 4) + 1} className="testimonial-card">
              <figure>
                <div className="testimonial-card__rating" aria-label={`${r.rating} out of 5 stars`}>
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <Icon key={idx} name="star" size={16} className={idx < r.rating ? 'is-filled' : 'is-empty'} />
                  ))}
                </div>
                <blockquote>&ldquo;{r.comment}&rdquo;</blockquote>
                <figcaption className="testimonial-card__author">
                  <span className="testimonial-card__avatar" aria-hidden="true">{name.charAt(0)}</span>
                  <span>
                    <strong>{name}</strong>
                    <span>
                      Verified buyer · <Link to={`/products/${r.product.id}`}>{r.product.name}</Link>
                    </span>
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
};

export default Testimonials;
