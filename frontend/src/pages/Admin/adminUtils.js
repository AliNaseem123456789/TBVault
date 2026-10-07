/** The backend's own message when there is one, otherwise a fallback. */
export const errorMessage = (err, fallback) => err?.response?.data?.message || fallback;

export { formatMoney } from '../../utils/money';

/** Value for <input type="datetime-local"> from an ISO date (local time). */
export const toLocalInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** ISO string from an <input type="datetime-local"> value, or null when empty. */
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);
