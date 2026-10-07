import Icon from '../../components/ui/Icon';
import { TIMELINE_STEPS, STATUS_TEXT, formatOrderDateTime } from '../../utils/order';

/**
 * placed → confirmed → shipped → delivered, with the time each step happened
 * (from the order's status history). A cancelled order shows where it stopped.
 */
const OrderTimeline = ({ order }) => {
  const history = order.status_history ?? [];
  const reachedAt = (status) => history.filter((h) => h.to_status === status).at(-1)?.created_at;
  const cancelledAt = order.status === 'cancelled' ? reachedAt('cancelled') ?? order.cancelled_at : null;
  const currentIndex = TIMELINE_STEPS.indexOf(order.status);
  const lastReached = cancelledAt
    ? Math.max(...TIMELINE_STEPS.map((s, i) => (reachedAt(s) ? i : -1)))
    : currentIndex;

  return (
    <ol className="order-timeline" aria-label="Order progress">
      {TIMELINE_STEPS.map((step, i) => {
        const done = i <= lastReached;
        const at = reachedAt(step);
        return (
          <li key={step} className={`order-timeline__step ${done ? 'is-done' : ''} ${i === lastReached && !cancelledAt ? 'is-current' : ''}`}>
            <span className="order-timeline__dot">{done && <Icon name="check" size={14} strokeWidth={2.4} />}</span>
            <span className="order-timeline__label">{STATUS_TEXT[step]}</span>
            {at && <span className="order-timeline__time">{formatOrderDateTime(at)}</span>}
          </li>
        );
      })}
      {cancelledAt && (
        <li className="order-timeline__step is-cancelled">
          <span className="order-timeline__dot"><Icon name="close" size={14} strokeWidth={2.4} /></span>
          <span className="order-timeline__label">Cancelled</span>
          <span className="order-timeline__time">{formatOrderDateTime(cancelledAt)}</span>
        </li>
      )}
    </ol>
  );
};

export default OrderTimeline;
