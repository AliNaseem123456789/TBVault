import Reveal from '../../../components/ui/Reveal';
import NewsletterForm from '../../../features/newsletter/NewsletterForm';

const NewsletterBand = () => (
  <section className="section container">
    <Reveal className="newsletter-band">
      <div>
        <h3>Drops, deals and restocks, first.</h3>
        <p>One email a week. Unsubscribe any time.</p>
      </div>
      <NewsletterForm />
    </Reveal>
  </section>
);

export default NewsletterBand;
