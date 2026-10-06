import Icon from '../../../components/ui/Icon';
import Reveal from '../../../components/ui/Reveal';
import { testimonials } from './placeholderData';

const Testimonials = () => (
  <section className="section testimonials container">
    <Reveal className="section-heading">
      <span className="badge">Loved by shoppers</span>
      <h2>Don't just take our word for it.</h2>
    </Reveal>
    <div className="testimonials__grid">
      {testimonials.map((t, i) => (
        <Reveal key={t.id} delay={(i % 4) + 1} className="testimonial-card card">
          <div className="testimonial-card__rating">
            {Array.from({ length: 5 }).map((_, idx) => (
              <Icon key={idx} name="star" size={14} className={idx < t.rating ? 'is-filled' : 'is-empty'} />
            ))}
          </div>
          <p>&ldquo;{t.quote}&rdquo;</p>
          <div className="testimonial-card__author">
            <strong>{t.name}</strong>
            <span>{t.role}</span>
          </div>
        </Reveal>
      ))}
    </div>
  </section>
);

export default Testimonials;
