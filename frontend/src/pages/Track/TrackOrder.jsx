import { useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  lookupOrder, getOrderByToken, cancelOrderByToken, payOrderByToken, requestReturnByToken,
} from '../../api/orders.api';
import OrderView from '../../features/orders/OrderView';
import { useOrderLoader } from '../../features/orders/useOrderLoader';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import '../OrderDetail/OrderDetail.css';
import './Track.css';

/** /track — find an order by number + email (works for guest orders too). */
export const TrackLookup = () => {
  const navigate = useNavigate();
  const [orderId, setOrderId] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ sending: false, error: '' });

  const submit = async (e) => {
    e.preventDefault();
    setState({ sending: true, error: '' });
    try {
      const res = await lookupOrder(Number(orderId.replace(/^#/, '')), email);
      navigate(`/track/${res.data.token}`);
    } catch (err) {
      setState({ sending: false, error: err?.response?.data?.message || 'Could not look up that order' });
    }
  };

  return (
    <div className="track-page container">
      <form className="card track-form" onSubmit={submit}>
        <Icon name="truck" size={28} />
        <h1>Track your order</h1>
        <p>Enter your order number and the email you used at checkout.</p>
        <div className="field">
          <label htmlFor="track-order">Order number</label>
          <input id="track-order" className="input" inputMode="numeric" placeholder="e.g. 1042" value={orderId} onChange={(e) => setOrderId(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="track-email">Email</label>
          <input id="track-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {state.error && <p className="form-alert form-alert-error">{state.error}</p>}
        <Button type="submit" size="lg" disabled={state.sending}>{state.sending ? 'Looking…' : 'Find my order'}</Button>
      </form>
    </div>
  );
};

/** /track/:token — the order behind a tracking link (guest emails, guest checkout). */
const TrackOrder = () => {
  const { token } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const paymentResult = searchParams.get('payment');
  const { status, order, reload } = useOrderLoader(() => getOrderByToken(token), token, { waitForPayment: paymentResult === 'success' });

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
        <p>This tracking link may be incomplete. You can look your order up instead.</p>
        <Button to="/track">Track an order</Button>
      </div>
    );
  }

  return (
    <OrderView
      order={order}
      backLink={{ to: '/track', label: 'Track another order' }}
      invoiceTo={`/track/${token}/invoice`}
      justPlaced={Boolean(location.state?.justPlaced)}
      paymentResult={paymentResult}
      actions={{
        cancel: async () => {
          await cancelOrderByToken(token);
          await reload();
        },
        pay: async () => {
          const res = await payOrderByToken(token);
          window.location.assign(res.data.checkout_url);
        },
        requestReturn: async (body) => {
          await requestReturnByToken(token, body);
          await reload();
        },
      }}
    />
  );
};

export default TrackOrder;
