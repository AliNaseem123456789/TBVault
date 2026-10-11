import { useCallback, useEffect, useState } from 'react';
import Button from '../../components/ui/Button';
import { getSellerTransactions } from '../../api/marketplace.api';
import { formatOrderDate, formatOrderDateTime } from '../../utils/order';
import { errorMessage, formatMoney } from '../Admin/adminUtils';

const LABELS = { earning: 'Order delivered', refund: 'Returned items', payout: 'Payout to you', adjustment: 'Adjustment' };

/** Balance, every movement on it, and payouts. */
const SellerEarnings = () => {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await getSellerTransactions({ page, limit: 20 });
      setData(res.data);
      setMeta(res.metaData);
    } catch (err) {
      setError(errorMessage(err, 'Could not load your earnings'));
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="form-alert form-alert-error">{error}</p>;
  if (!data) return <div className="skeleton" style={{ height: 200 }} />;

  return (
    <div className="admin-panel">
      <div className="admin-stats">
        <div className="card admin-stat">
          <span className="admin-stat__label">Balance</span>
          <span className="admin-stat__value">{formatMoney(data.money.balance)}</span>
          <span className="admin-stat__change">Paid out to you by the store</span>
        </div>
        <div className="card admin-stat">
          <span className="admin-stat__label">On the way</span>
          <span className="admin-stat__value">{formatMoney(data.money.pending_earnings)}</span>
          <span className="admin-stat__change">Added once orders are delivered and paid</span>
        </div>
        <div className="card admin-stat">
          <span className="admin-stat__label">Paid out so far</span>
          <span className="admin-stat__value">{formatMoney(data.money.paid_out)}</span>
          <span className="admin-stat__change">{data.payouts.length ? `Last on ${formatOrderDate(data.payouts[0].created_at)}` : 'No payouts yet'}</span>
        </div>
      </div>

      <h3>History</h3>
      {data.transactions.length === 0 ? (
        <p className="admin-muted">Nothing yet. Earnings appear here when your orders are delivered.</p>
      ) : (
        <div className="admin-table-wrap card">
          <table className="admin-table">
            <thead><tr><th scope="col">What</th><th scope="col">When</th><th scope="col" className="is-num">Amount</th></tr></thead>
            <tbody>
              {data.transactions.map((t) => (
                <tr key={t.id}>
                  <td>
                    {LABELS[t.type] ?? t.type}
                    {t.seller_order && <span className="admin-muted"> · order #{t.seller_order.order_id}</span>}
                    {t.payout?.reference && <span className="admin-muted"> · {t.payout.reference}</span>}
                  </td>
                  <td>{formatOrderDateTime(t.created_at)}</td>
                  <td className={`is-num ${Number(t.amount) < 0 ? 'admin-danger' : ''}`}>{Number(t.amount) > 0 ? '+' : '−'}{formatMoney(Math.abs(Number(t.amount)))}</td>
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

export default SellerEarnings;
