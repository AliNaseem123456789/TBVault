import { Link } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import InfoPage from './InfoPage';
import { useAuth } from '../../features/auth/AuthProvider';

const STEPS = [
  { icon: 'gift', title: 'Got a gift card?', text: 'Enter its code (it looks like TBV-XXXX-XXXX-XXXX) on your Store credit page. The full value is added to your balance.' },
  { icon: 'wallet', title: 'Top up your balance', text: 'Add $5 to $1,000 of store credit by card, any time, from the Store credit page.' },
  { icon: 'cart', title: 'Spend it at checkout', text: 'Tick "Use store credit" to pay part or all of an order. Pay any rest by card or cash on delivery.' },
];

const GiftCards = () => {
  const { user } = useAuth();
  const walletLink = user ? '/wallet' : '/login';
  return (
    <InfoPage
      section="company"
      eyebrow="Gift cards"
      title="Store credit and gift cards"
      lead="One balance you can top up, receive as a gift, and spend across every store on TBVault."
      actions={(
        <>
          <Button to={walletLink}>{user ? 'Go to my store credit' : 'Sign in to redeem'}</Button>
          <Button to="/shop" variant="ghost">Browse the shop</Button>
        </>
      )}
    >
      <h2>How it works</h2>
      <div className="info-cards">
        {STEPS.map((s) => (
          <div key={s.title} className="info-card">
            <Icon name={s.icon} size={24} />
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        ))}
      </div>

      <h2>Good to know</h2>
      <ul>
        <li>Each gift card code works once. Some have an expiry date.</li>
        <li>Refunds paid as store credit arrive instantly.</li>
        <li>Store credit can't be withdrawn as cash.</li>
        <li>Want to give gift cards to a team or for a giveaway? <Link to="/contact">Contact us</Link> and we'll set them up.</li>
      </ul>
    </InfoPage>
  );
};

export default GiftCards;
