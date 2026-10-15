import { Link } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import InfoPage from './InfoPage';

const COMMITMENTS = [
  { icon: 'store', title: 'Fewer, better things', text: 'We favor products built to last and sellers who stand behind them with clear return windows.' },
  { icon: 'return', title: 'Returns that don’t go to waste', text: 'Returned items in good condition go back into stock instead of being thrown away.' },
  { icon: 'truck', title: 'Smarter shipping', text: 'Each seller sends their items together in one package per order, not one box per item.' },
  { icon: 'receipt', title: 'Paperless by default', text: 'Receipts, invoices and order updates are digital. Invoices can be printed from the order page if you need them.' },
];

const Sustainability = () => (
  <InfoPage
    section="company"
    eyebrow="Sustainability"
    title="Buy less often, buy better."
    lead="The most sustainable product is the one you don't have to replace. Here's what we do, and what we're still working on."
  >
    <h2>What we do today</h2>
    <div className="info-cards">
      {COMMITMENTS.map((c) => (
        <div key={c.title} className="info-card">
          <Icon name={c.icon} size={24} />
          <h3>{c.title}</h3>
          <p>{c.text}</p>
        </div>
      ))}
    </div>

    <h2>What we're working on</h2>
    <ul>
      <li>Packaging guidelines for sellers: recycled, plastic-free filler and right-sized boxes.</li>
      <li>Showing repairability and warranty details on product pages.</li>
      <li>Grouping deliveries from sellers in the same city.</li>
    </ul>
    <p>Have an idea? <Link to="/contact">Tell us</Link>.</p>
  </InfoPage>
);

export default Sustainability;
