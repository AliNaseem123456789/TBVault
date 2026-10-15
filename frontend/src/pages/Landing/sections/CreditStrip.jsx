import Button from '../../../components/ui/Button';
import Reveal from '../../../components/ui/Reveal';

const CreditStrip = () => (
  <section className="container">
    <Reveal className="credit-strip">
      <div>
        <h3>Top up store credit, check out in one tap.</h3>
        <p>Gift it with a gift card, or keep it for your next order.</p>
      </div>
      <Button to="/gift-cards" variant="light" size="lg">Gift cards &amp; credit</Button>
    </Reveal>
  </section>
);

export default CreditStrip;
