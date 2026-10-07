import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { getOrderById, cancelOrder, payOrder, requestReturn } from '../../api/orders.api';
import OrderView from '../../features/orders/OrderView';
import { useOrderLoader } from '../../features/orders/useOrderLoader';
import Button from '../../components/ui/Button';
import './OrderDetail.css';

/** /orders/:id — a signed-in customer's own order (the API 404s anyone else's). */
const OrderDetail = () => {
  const { id } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const paymentResult = searchParams.get('payment');
  const { status, order, reload } = useOrderLoader(() => getOrderById(id), id, { waitForPayment: paymentResult === 'success' });

  if (status === 'loading') {
    return (
      <div className="order-detail container">
        <div className="skeleton" style={{ height: 32, width: '30%', marginBottom: 'var(--space-5)' }} />
        <div className="skeleton" style={{ height: 220 }} />
      </div>
    );
  }
  if (status !== 'ready') {
    return (
      <div className="order-detail container order-detail--empty">
        <h1>{status === 'notFound' ? 'Order not found' : "Couldn't load this order"}</h1>
        <p>{status === 'notFound' ? 'It may not exist, or the link is incorrect.' : 'Make sure the API is running, then refresh the page.'}</p>
        <Button to="/orders">Back to your orders</Button>
      </div>
    );
  }

  return (
    <OrderView
      order={order}
      backLink={{ to: '/orders', label: 'Back to your orders' }}
      invoiceTo={`/orders/${order.id}/invoice`}
      justPlaced={Boolean(location.state?.justPlaced)}
      paymentResult={paymentResult}
      actions={{
        cancel: async () => {
          await cancelOrder(order.id);
          await reload();
        },
        pay: async () => {
          const res = await payOrder(order.id);
          window.location.assign(res.data.checkout_url);
        },
        requestReturn: async (body) => {
          await requestReturn(order.id, body);
          await reload();
        },
      }}
    />
  );
};

export default OrderDetail;
