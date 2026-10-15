import Icon from '../../../components/ui/Icon';
import Reveal from '../../../components/ui/Reveal';

// Only things the store really does (see checkout, tracking, returns and seller approval).
const ITEMS = [
  { icon: 'card', title: 'Card or cash', desc: 'Pay online or on delivery' },
  { icon: 'truck', title: 'Live tracking', desc: 'No account needed' },
  { icon: 'return', title: 'Easy returns', desc: 'Start one from your order' },
  { icon: 'shield', title: 'Verified sellers', desc: 'Every store is approved' },
];

const TrustBar = () => (
  <section className="container">
    <div className="trust-bar">
      {ITEMS.map((item, i) => (
        <Reveal key={item.title} delay={(i % 4) + 1} className="trust-bar__item">
          <Icon name={item.icon} size={24} />
          <div>
            <strong>{item.title}</strong>
            <span>{item.desc}</span>
          </div>
        </Reveal>
      ))}
    </div>
  </section>
);

export default TrustBar;
