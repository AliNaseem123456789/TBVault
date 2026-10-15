import { Link } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import InfoPage from './InfoPage';
import { useStoreConfig } from '../../features/store/useStoreConfig';

const TOPICS = [
  { icon: 'truck', title: 'Track an order', text: 'With your order number and email, no account needed.', to: '/track' },
  { icon: 'return', title: 'Returns & refunds', text: 'How to send something back and when the money arrives.', to: '/shipping-returns' },
  { icon: 'wallet', title: 'Gift cards & credit', text: 'Redeem a code or top up your store credit.', to: '/gift-cards' },
  { icon: 'chat', title: 'Contact us', text: "Can't find it here? Send us a message.", to: '/contact' },
];

/** FAQ text follows the store policies the chat assistant also answers from (chatbot/knowledge/). */
const HelpCenter = () => {
  const config = useStoreConfig();
  const returnDays = config?.return_window_days ?? 30;
  const taxRate = config?.tax_rate ?? 0;

  return (
    <InfoPage
      section="support"
      eyebrow="Support"
      title="How can we help?"
      lead="Quick answers about orders, payments, delivery and returns. Our chat assistant (bottom right) can also look up your orders when you're signed in."
    >
      <div className="info-cards" style={{ marginBottom: 'var(--space-8)' }}>
        {TOPICS.map((t) => (
          <Link key={t.to} to={t.to} className="info-card">
            <Icon name={t.icon} size={24} />
            <h3>{t.title}</h3>
            <p>{t.text}</p>
          </Link>
        ))}
      </div>

      <h2>Orders</h2>
      <div className="faq">
        <details>
          <summary>Can I cancel my order?</summary>
          <div>
            <p>Yes, while it is <strong>Pending</strong> or <strong>Confirmed</strong>. Open the order and choose Cancel, or ask the chat assistant. Once any part has shipped it can't be cancelled; you can return it after delivery instead.</p>
            <p>When you cancel, card payments are refunded automatically and any store credit you used goes back to your balance.</p>
          </div>
        </details>
        <details>
          <summary>Can I change an order after placing it?</summary>
          <div><p>Orders can't be edited. If it hasn't shipped yet, cancel it and place a new one.</p></div>
        </details>
        <details>
          <summary>Why did my order arrive in several packages?</summary>
          <div><p>TBVault is a marketplace: when your cart has items from different sellers, each seller ships their own items. You pay shipping once per order, and each package has its own status and tracking number on the order page.</p></div>
        </details>
        <details>
          <summary>I checked out as a guest. How do I see my order?</summary>
          <div><p>Use <Link to="/track">Track order</Link> with your order number and the email you used at checkout. From there you can also cancel the order while it hasn't shipped.</p></div>
        </details>
      </div>

      <h2>Payments</h2>
      <div className="faq">
        <details>
          <summary>How can I pay?</summary>
          <div>
            <ul>
              <li><strong>Card</strong>, paid securely through Stripe. We never see or store your card number.</li>
              <li><strong>Cash on delivery</strong>: pay when the order arrives.</li>
              <li><strong>Store credit</strong> for part or all of an order; pay the rest by card or cash.</li>
            </ul>
          </div>
        </details>
        <details>
          <summary>My card payment failed. What now?</summary>
          <div><p>Your order stays unpaid. Open it and try paying again, or cancel it while it hasn't shipped.</p></div>
        </details>
        <details>
          <summary>How are tax and coupons applied?</summary>
          <div><p>Prices are in US dollars and sale prices apply automatically. {taxRate > 0 ? `Tax is ${taxRate}% of the order after discounts; shipping isn't taxed.` : 'No sales tax is currently charged.'} Enter coupon codes at checkout; each has its own rules such as a minimum spend or an expiry date.</p></div>
        </details>
      </div>

      <h2>Returns</h2>
      <div className="faq">
        <details>
          <summary>How long do I have to return something?</summary>
          <div><p>{returnDays} days after your order is delivered. Start a return from the order page. See <Link to="/shipping-returns">Shipping &amp; returns</Link> for the full steps.</p></div>
        </details>
        <details>
          <summary>When will I get my refund?</summary>
          <div><p>Once we receive the items. Card refunds go back to the same card (banks usually take 5 to 10 business days); store credit refunds are instant.</p></div>
        </details>
      </div>

      <h2>Account</h2>
      <div className="faq">
        <details>
          <summary>Do I need an account to shop?</summary>
          <div><p>No. Guests can check out and track orders. An account keeps your addresses, wishlist, order history and store credit in one place.</p></div>
        </details>
        <details>
          <summary>How do I get back-in-stock alerts?</summary>
          <div><p>On a sold-out product, choose "Email me when it's back". We email you once when it's in stock again.</p></div>
        </details>
      </div>
    </InfoPage>
  );
};

export default HelpCenter;
