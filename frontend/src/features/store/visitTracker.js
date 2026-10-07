import { recordVisit } from '../../api/store.api';

const VISITOR_KEY = 'tbvault.visitor';
const SENT_KEY = 'tbvault.visitDay';

/**
 * Counts this browser once per day for the admin dashboard's conversion rate.
 * The id is random and stays in this browser; it isn't linked to an account.
 */
export const trackVisit = () => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(SENT_KEY) === today) return;
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, id);
    }
    localStorage.setItem(SENT_KEY, today);
    recordVisit(id).catch(() => localStorage.removeItem(SENT_KEY));
  } catch {
    /* storage blocked: skip analytics */
  }
};
