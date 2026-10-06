/**
 * Small shared helpers for the Orders / OrderDetail pages — status
 * badge styling and date formatting, so both pages render an order's
 * status the same way instead of duplicating the mapping.
 *
 * Statuses seen in orders.controller.js: "pending" (the Prisma
 * default), "confirmed", "cancelled" (set by cancelOrder). Anything
 * else falls back to the neutral/muted badge rather than guessing.
 */
const STATUS_BADGE_CLASS = {
  pending: 'badge-muted',
  confirmed: 'badge-secondary',
  shipped: '',
  delivered: 'badge-secondary',
  cancelled: 'badge-danger',
};

// Mirrors NEXT_STATUS in order.controller.js: which status an admin can move an order to.
export const NEXT_STATUSES = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};
export const ORDER_STATUSES = Object.keys(NEXT_STATUSES);

export const statusBadgeClass = (status) => STATUS_BADGE_CLASS[status] ?? 'badge-muted';

// Only "pending" and "confirmed" orders can be cancelled — mirrors
// orders.controller.js's cancelOrder CANCELLABLE list, so the button
// doesn't appear only to 400 when clicked.
const CANCELLABLE_STATUSES = ['pending', 'confirmed'];
export const isCancellable = (status) => CANCELLABLE_STATUSES.includes(status);

export const formatOrderDate = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
};
