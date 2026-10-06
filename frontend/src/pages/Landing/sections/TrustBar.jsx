import Icon from '../../../components/ui/Icon';
import Reveal from '../../../components/ui/Reveal';

const ITEMS = [
  { icon: 'truck', title: 'Free shipping', desc: 'On every order over $50' },
  { icon: 'shield', title: 'Secure checkout', desc: '256-bit encrypted payments' },
  { icon: 'headset', title: '24/7 support', desc: 'Real humans, real fast' },
  { icon: 'star', title: '4.9 average', desc: 'From 12,000+ reviews' },
];

const TrustBar = () => (
  <section className="trust-bar container">
    {ITEMS.map((item, i) => (
      <Reveal key={item.title} delay={(i % 4) + 1} className="trust-bar__item">
        <Icon name={item.icon} size={22} />
        <div>
          <strong>{item.title}</strong>
          <span>{item.desc}</span>
        </div>
      </Reveal>
    ))}
  </section>
);

export default TrustBar;
