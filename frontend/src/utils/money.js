/** "$12.50" — every price on the site goes through this. */
export const formatMoney = (value) => `$${Number(value ?? 0).toFixed(2)}`;
