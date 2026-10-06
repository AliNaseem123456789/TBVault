/** The backend's own message when there is one, otherwise a fallback. */
export const errorMessage = (err, fallback) => err?.response?.data?.message || fallback;

export const formatMoney = (value) => `$${Number(value ?? 0).toFixed(2)}`;
