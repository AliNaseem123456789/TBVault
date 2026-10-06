import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../components/ui/Button';
import StarRating from '../../components/ui/StarRating';
import { useAuth } from '../auth/AuthProvider';
import {
  getProductReviews,
  getReviewEligibility,
  createReview,
  updateReview,
  deleteReview,
} from '../../api/reviews.api';
import './ProductReviews.css';

const PAGE_SIZE = 5;

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Write or edit a review. `initial` is the user's existing review when editing. */
const ReviewForm = ({ initial, onSubmit, onCancel }) => {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!rating) {
      setError('Pick a star rating.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ rating, comment: comment.trim() || null });
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save your review.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card review-form" onSubmit={handleSubmit}>
      <h3>{initial ? 'Edit your review' : 'Write a review'}</h3>
      <div className="field">
        <label>Your rating</label>
        <StarRating value={rating} onChange={setRating} size={24} label="Your rating" />
      </div>
      <div className="field">
        <label htmlFor="review-comment">Your review (optional)</label>
        <textarea
          id="review-comment"
          className="input review-form__textarea"
          rows={4}
          maxLength={2000}
          placeholder="What did you like or dislike?"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      {error && <p className="form-alert form-alert-error">{error}</p>}
      <div className="review-form__actions">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Post review'}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
};

const ProductReviews = ({ productId }) => {
  const { isAuthenticated, user } = useAuth();

  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [eligibility, setEligibility] = useState(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(
    async (nextPage = 1) => {
      try {
        const res = await getProductReviews(productId, { page: nextPage, limit: PAGE_SIZE });
        setReviews((prev) => (nextPage === 1 ? res.data.reviews : [...prev, ...res.data.reviews]));
        setSummary(res.data.summary);
        setHasNext(res.metaData.hasNext);
        setPage(nextPage);
        setStatus('ready');
      } catch (err) {
        console.error('Failed to load reviews:', err);
        setStatus('error');
      }
    },
    [productId]
  );

  const loadEligibility = useCallback(async () => {
    if (!isAuthenticated) {
      setEligibility(null);
      return;
    }
    try {
      const res = await getReviewEligibility(productId);
      setEligibility(res.data);
    } catch (err) {
      console.error('Failed to check review eligibility:', err);
    }
  }, [productId, isAuthenticated]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');
    setEditing(false);
    load(1);
  }, [load]);

  useEffect(() => {
    loadEligibility();
  }, [loadEligibility]);

  const refreshAll = async () => {
    setEditing(false);
    await Promise.all([load(1), loadEligibility()]);
  };

  const myReview = eligibility?.review;

  const handleDelete = async () => {
    if (!myReview) return;
    try {
      await deleteReview(myReview.id);
      await refreshAll();
    } catch (err) {
      console.error('Failed to delete review:', err);
    }
  };

  return (
    <section className="section product-reviews" aria-labelledby="reviews-heading">
      <div className="product-reviews__header">
        <div>
          <span className="badge badge-secondary">Reviews</span>
          <h2 id="reviews-heading">What buyers say.</h2>
        </div>
        {summary?.count > 0 && (
          <div className="product-reviews__summary">
            <strong>{summary.average.toFixed(1)}</strong>
            <div>
              <StarRating value={summary.average} />
              <span>
                {summary.count} review{summary.count === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Who can write a review, and what they see */}
      {!isAuthenticated && (
        <p className="product-reviews__note">
          <Link to="/login">Log in</Link> to review products you've ordered.
        </p>
      )}
      {isAuthenticated && eligibility?.canReview && (
        <ReviewForm onSubmit={async (values) => { await createReview(productId, values); await refreshAll(); }} />
      )}
      {isAuthenticated && myReview && editing && (
        <ReviewForm
          initial={myReview}
          onSubmit={async (values) => { await updateReview(myReview.id, values); await refreshAll(); }}
          onCancel={() => setEditing(false)}
        />
      )}
      {isAuthenticated && eligibility && !eligibility.purchased && (
        <p className="product-reviews__note">You can review this product once you've ordered it.</p>
      )}

      {status === 'loading' && <div className="skeleton product-reviews__skeleton" />}
      {status === 'error' && <p className="product-reviews__note">Couldn't load reviews right now.</p>}
      {status === 'ready' && reviews.length === 0 && (
        <p className="product-reviews__note">No reviews yet.</p>
      )}

      {reviews.length > 0 && (
        <ul className="product-reviews__list">
          {reviews.map((r) => {
            const mine = user && r.user_id === user.id;
            return (
              <li key={r.id} className="card review-item">
                <div className="review-item__top">
                  <StarRating value={r.rating} size={14} />
                  <span className="review-item__date">{formatDate(r.created_at)}</span>
                </div>
                {r.comment && <p className="review-item__comment">{r.comment}</p>}
                <div className="review-item__author">
                  <strong>{r.user?.name || 'Customer'}</strong>
                  <span>Verified buyer{mine ? ' · You' : ''}</span>
                  {mine && !editing && (
                    <span className="review-item__actions">
                      <button type="button" onClick={() => setEditing(true)}>Edit</button>
                      <button type="button" onClick={handleDelete}>Delete</button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasNext && (
        <Button variant="ghost" onClick={() => load(page + 1)} className="product-reviews__more">
          Show more reviews
        </Button>
      )}
    </section>
  );
};

export default ProductReviews;
