import Icon from './Icon';
import './StarRating.css';

/**
 * Read-only stars by default. Pass `onChange` to make it an input:
 *   <StarRating value={4} />
 *   <StarRating value={rating} onChange={setRating} />
 */
const StarRating = ({ value = 0, onChange, size = 16, label = 'Rating' }) => {
  const rounded = Math.round(value);

  if (!onChange) {
    return (
      <span className="star-rating" role="img" aria-label={`${value} out of 5 stars`}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Icon key={i} name="star" size={size} className={i < rounded ? 'is-filled' : 'is-empty'} />
        ))}
      </span>
    );
  }

  return (
    <span className="star-rating star-rating--input" role="radiogroup" aria-label={label}>
      {Array.from({ length: 5 }).map((_, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={rounded === i + 1}
          aria-label={`${i + 1} star${i ? 's' : ''}`}
          onClick={() => onChange(i + 1)}
        >
          <Icon name="star" size={size} className={i < rounded ? 'is-filled' : 'is-empty'} />
        </button>
      ))}
    </span>
  );
};

export default StarRating;
