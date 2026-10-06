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
    <section className="section testimonials container">
      <Reveal className="section-heading">
        <span className="badge">Loved by shoppers</span>
        <h2>Don't just take our word for it.</h2>
      </Reveal>
      <div className="testimonials__grid">
        {reviews.map((r, i) => (
          <Reveal key={r.id} delay={(i % 4) + 1} className="testimonial-card card">
            <div className="testimonial-card__rating">
              {Array.from({ length: 5 }).map((_, idx) => (
                <Icon key={idx} name="star" size={14} className={idx < r.rating ? 'is-filled' : 'is-empty'} />
              ))}
            </div>
            <p>&ldquo;{r.comment}&rdquo;</p>
            <div className="testimonial-card__author">
              <strong>{r.user?.name || 'Customer'}</strong>
              <span>
                Verified buyer · <Link to={`/products/${r.product.id}`}>{r.product.name}</Link>
              </span>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
};

export default Testimonials;
