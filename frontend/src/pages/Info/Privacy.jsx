import { Link } from 'react-router-dom';
import InfoPage from './InfoPage';
import { useCompany } from '../../content/company';

/** Plain-language privacy policy describing what this app actually stores. Demo legal text. */
const Privacy = () => {
  const company = useCompany();
  return (
    <InfoPage section="legal" eyebrow="Legal" title="Privacy policy" lead={`Last updated ${company.lastUpdated}. This explains what we collect, why, and the choices you have.`}>
      <p className="info-note">TBVault is a demo project. This policy is an example and not legal advice.</p>

      <h2>Who we are</h2>
      <p>{company.legalName} (“{company.name}”, “we”) runs this marketplace. Contact us about privacy at <a href={`mailto:${company.privacyEmail}`}>{company.privacyEmail}</a>.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details</strong>: your name, email and a securely hashed password, or your Google sign-in if you use it.</li>
        <li><strong>Orders</strong>: what you bought, delivery addresses, phone number, order history and returns.</li>
        <li><strong>Payments</strong>: card payments are handled by Stripe. We receive the payment status, never your full card number.</li>
        <li><strong>Store credit</strong>: your balance and its history (top-ups, gift cards, refunds, purchases).</li>
        <li><strong>Messages</strong>: what you send through the Contact page or the chat assistant.</li>
        <li><strong>Basic usage</strong>: a random visitor ID counted once a day, to measure how many visitors place orders.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To process, ship and support your orders, refunds and returns.</li>
        <li>To send order emails, password resets and the alerts you asked for (back in stock, newsletter).</li>
        <li>To keep the marketplace safe, for example blocking fraudulent accounts.</li>
      </ul>

      <h2>Who we share it with</h2>
      <ul>
        <li><strong>Sellers</strong> receive the name, address and items they need to ship your order.</li>
        <li><strong>Service providers</strong>: Stripe (payments), our email provider and our hosting provider, only to run the store.</li>
        <li>We never sell your personal information.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>Update your details under <Link to="/profile">Profile</Link>.</li>
        <li>Unsubscribe from the newsletter using the link in any email.</li>
        <li>Ask for a copy of your data or for your account to be deleted by emailing <a href={`mailto:${company.privacyEmail}`}>{company.privacyEmail}</a>. We keep order records as long as tax law requires.</li>
      </ul>

      <h2>Cookies</h2>
      <p>We use a sign-in cookie to keep you logged in and local storage for your cart. We don't use advertising cookies.</p>

      <h2>Changes</h2>
      <p>If we change this policy we'll update the date at the top, and email account holders about significant changes.</p>
    </InfoPage>
  );
};

export default Privacy;
