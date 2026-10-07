// Product ids this browser looked at recently, newest first (for "Recently viewed").
const KEY = 'tbvault.recentlyViewed';
const MAX = 12;

export const getRecentlyViewed = () => {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
};

export const addRecentlyViewed = (productId) => {
  try {
    const ids = [productId, ...getRecentlyViewed().filter((id) => id !== productId)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage blocked */
  }
};
