/** How each kind of store-credit movement is described to people. */
export const CREDIT_TYPE_LABELS = {
  topup: 'Added by card',
  refund: 'Refund',
  admin_grant: 'Added by the store',
  admin_deduct: 'Removed by the store',
  gift_card: 'Gift card',
  order_payment: 'Spent on an order',
  order_cancel: 'Returned from a cancelled order',
};
