import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import { listReviews, setReviewHidden, deleteReview } from '../../api/admin.api';
import { errorMessage } from './adminUtils';
import { formatOrderDate } from '../../utils/order';

const PAGE_SIZE = 20;

/** Hide, re-publish or delete reviews. Hidden reviews don't count toward a product's rating. */
const AdminReviews = () => {
  const [reviews, setReviews] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [visibility, setVisibility] = useState('');
  const [rating, setRating] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (visibility) params.visibility = visibility;
      if (rating) params.rating = rating;
      if (query) params.search = query;
      const res = await listReviews(params);
      setReviews(res.data.reviews);
      setMeta(res.metaData);
    } catch (err) {
      setError(errorMessage(err, 'Could not load reviews'));
    }
  }, [page, visibility, rating, query]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'));
    }
  };

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <form className="admin-search" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()); }}>
          <input className="input" placeholder="Text, product or reviewer email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search reviews" />
          <Button type="submit" variant="ghost" size="sm"><Icon name="search" size={16} /> Search</Button>
        </form>
      </div>
      <div className="admin-filter" role="group" aria-label="Filters">
        {[['', 'All'], ['visible', 'Visible'], ['hidden', 'Hidden']].map(([v, label]) => (
          <button key={label} type="button" className={`admin-chip ${visibility === v ? 'is-active' : ''}`} onClick={() => { setPage(1); setVisibility(v); }}>{label}</button>
        ))}
        <span className="admin-filter__divider" aria-hidden="true" />
        {['', '1', '2', '3', '4', '5'].map((r) => (
          <button key={r || 'any'} type="button" className={`admin-chip ${rating === r ? 'is-active' : ''}`} onClick={() => { setPage(1); setRating(r); }}>{r ? `${r}★` : 'Any rating'}</button>
        ))}
      </div>
      {error && <p className="form-alert form-alert-error">{error}</p>}
      {reviews.length === 0 && <p className="admin-muted">No reviews here.</p>}

      <ul className="admin-returns">
        {reviews.map((r) => (
          <li key={r.id} className={`card admin-return ${r.is_hidden ? 'is-muted' : ''}`}>
            <div className="admin-return__head">
              <div>
                <strong>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</strong> · {r.product?.name}
                <div className="admin-muted">{r.user?.name || r.user?.email} · {r.user?.email} · {formatOrderDate(r.created_at)}</div>
              </div>
              {r.is_hidden && <span className="badge badge-muted">hidden</span>}
            </div>
            {r.comment ? <p className="admin-return__reason">{r.comment}</p> : <p className="admin-muted">(No comment)</p>}
            <div className="admin-row-actions">
              <Button size="sm" variant="ghost" onClick={() => act(() => setReviewHidden(r.id, !r.is_hidden))}>{r.is_hidden ? 'Publish' : 'Hide'}</Button>
              <Button size="sm" variant="ghost" className="admin-danger" onClick={() => window.confirm('Delete this review permanently?') && act(() => deleteReview(r.id))}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>

      {meta && meta.totalPages > 1 && (
        <div className="admin-pager">
          <Button variant="ghost" size="sm" disabled={!meta.hasPrev} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>Page {meta.currentPage} of {meta.totalPages}</span>
          <Button variant="ghost" size="sm" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
};

export default AdminReviews;
