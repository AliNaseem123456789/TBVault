import { Link } from 'react-router-dom';
import InfoPage from './InfoPage';
import { useCompany } from '../../content/company';
import { useStoreConfig } from '../../features/store/useStoreConfig';

/** Terms of service. Demo legal text that matches how the store works. */
const Terms = () => {
  const company = useCompany();
  const config = useStoreConfig();
  const returnDays = config?.return_window_days ?? 30;
  return (
    <InfoPage section="legal" eyebrow="Legal" title="Terms of service" lead={`Last updated ${company.lastUpdated}. By using ${company.name} you agree to these terms.`}>
      <p className="info-note">TBVault is a demo project. These terms are an example and not legal advice.</p>

      <h2>1. The marketplace</h2>
      <p>{company.name} is a marketplace run by {company.legalName}. Products are sold by approved independent sellers; we run the checkout, payments and customer support for every order.</p>

      <h2>2. Accounts</h2>
      <p>You're responsible for keeping your password safe and for activity on your account. We may suspend accounts used for fraud or abuse. You can also shop as a guest.</p>

      <h2>3. Orders and prices</h2>
      <ul>
        <li>Prices are in US dollars. The total, including shipping, discounts and tax, is shown before you pay.</li>
        <li>An order is accepted when the seller confirms it. If an item turns out to be unavailable, we cancel it and refund you in full.</li>
        <li>You can cancel an order until it ships. See <Link to="/help">Help center</Link>.</li>
      </ul>

      <h2>4. Payment</h2>
      <p>You can pay by card (processed by Stripe), cash on delivery or store credit. Cash on delivery orders must be paid in full when delivered.</p>

      <h2>5. Store credit and gift cards</h2>
      <p>Store credit and gift cards can only be spent on {company.name} and can't be exchanged for cash. Each gift card code can be redeemed once and may have an expiry date.</p>

      <h2>6. Returns and refunds</h2>
      <p>You can request a return within {returnDays} days of delivery, as described in <Link to="/shipping-returns">Shipping &amp; returns</Link>. Refunds go back the way you paid.</p>

      <h2>7. Sellers</h2>
      <p>Sellers must describe products accurately, ship on time and honor returns. Seller terms are agreed when a store is approved.</p>

      <h2>8. Liability</h2>
      <p>We do our best to keep the store available and accurate, but can't guarantee it will be error-free. Nothing in these terms limits rights you have under consumer law.</p>

      <h2>9. Contact</h2>
      <p>Questions about these terms: <a href={`mailto:${company.email}`}>{company.email}</a>, {company.address.join(', ')}.</p>
    </InfoPage>
  );
};

export default Terms;
