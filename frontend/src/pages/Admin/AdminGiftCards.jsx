import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import { listGiftCards, createGiftCards, setGiftCardActive } from '../../api/wallet.api';
import { formatOrderDate } from '../../utils/order';
import { errorMessage, formatMoney, fromLocalInput } from './adminUtils';

const PAGE_SIZE = 20;
const FILTERS = [['', 'All'], ['unused', 'Unused'], ['redeemed', 'Redeemed'], ['inactive', 'Disabled']];
const EMPTY = { amount: '', quantity: '1', expires_at: '', note: '' };

/** Gift cards: single-use codes worth store credit. */
const AdminGiftCards = () => {
  const [cards, setCards] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (filter) params.status = filter;
      if (query) params.search = query;
      const res = await listGiftCards(params);
      setCards(res.data.gift_cards);
      setMeta(res.metaData);
    } catch (err) {
      setError(errorMessage(err, 'Could not load gift cards'));
    }
  }, [page, filter, query]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await createGiftCards({
        amount: Number(form.amount),
        quantity: Number(form.quantity),
        expires_at: fromLocalInput(form.expires_at) ?? undefined,
        note: form.note || undefined,
      });
      setCreated(res.data.gift_cards);
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not create gift cards'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (card) => {
    setError('');
    try {
      await setGiftCardActive(card.id, !card.is_active);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not update the gift card'));
    }
  };

  return (
    <div className="admin-panel">
      <form className="card admin-editor admin-form" onSubmit={create}>
        <h2 className="admin-form__wide">New gift cards</h2>
        <div className="field">
          <label htmlFor="gc-amount">Value ($)</label>
          <input id="gc-amount" className="input" type="number" min="1" max="1000" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="gc-qty">How many</label>
          <input id="gc-qty" className="input" type="number" min="1" max="50" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="gc-exp">Expires (optional)</label>
          <input id="gc-exp" className="input" type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="gc-note">Note (optional)</label>
          <input id="gc-note" className="input" maxLength={255} placeholder="e.g. Eid giveaway" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <div className="admin-form__actions admin-form__wide">
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button>
        </div>
        {created.length > 0 && (
          <div className="admin-form__wide form-alert form-alert-success">
            <p>New codes — copy them now to share:</p>
            <pre className="admin-codes">{created.map((c) => `${c.code}  ${formatMoney(c.amount)}`).join('\n')}</pre>
          </div>
        )}
      </form>

      <div className="admin-toolbar">
        <form className="admin-search" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search.trim()); }}>
          <input className="input" placeholder="Search code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search gift cards" />
          <Button type="submit" variant="ghost" size="sm"><Icon name="search" size={16} /> Search</Button>
        </form>
      </div>
      <div className="admin-filter" role="group" aria-label="Filter gift cards">
        {FILTERS.map(([value, label]) => (
          <button key={value || 'all'} type="button" className={`admin-chip ${filter === value ? 'is-active' : ''}`} onClick={() => { setPage(1); setFilter(value); }}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="form-alert form-alert-error">{error}</p>}

      {cards.length === 0 ? (
        <p className="admin-muted">No gift cards here.</p>
      ) : (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col" className="is-num">Value</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <td>
                    <code>{c.code}</code>
                    {c.note && <div className="admin-muted">{c.note}</div>}
                  </td>
                  <td className="is-num">{formatMoney(c.amount)}</td>
                  <td>
                    {c.redeemed_at ? (
                      <span className="admin-muted">Redeemed by {c.redeemer?.email ?? 'a deleted account'} · {formatOrderDate(c.redeemed_at)}</span>
                    ) : !c.is_active ? (
                      <span className="badge badge-muted">disabled</span>
                    ) : c.expires_at && new Date(c.expires_at) < new Date() ? (
                      <span className="badge badge-muted">expired</span>
                    ) : (
                      <span className="badge badge-secondary">unused{c.expires_at ? ` · until ${formatOrderDate(c.expires_at)}` : ''}</span>
                    )}
                  </td>
                  <td>{formatOrderDate(c.created_at)}</td>
                  <td className="is-num admin-row-actions">
                    {!c.redeemed_at && (
                      <Button size="sm" variant="ghost" className={c.is_active ? 'admin-danger' : ''} onClick={() => toggle(c)}>
                        {c.is_active ? 'Disable' : 'Enable'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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

export default AdminGiftCards;
