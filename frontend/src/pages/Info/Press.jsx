import InfoPage from './InfoPage';
import { COMPANY } from '../../content/company';

// The company's own announcements (demo content).
const NEWS = [
  { date: 'September 2026', title: 'TBVault adds store credit and gift cards', text: 'Customers can top up a balance, gift it with a code, and get instant refunds as store credit.' },
  { date: 'July 2026', title: 'Independent sellers can now open stores on TBVault', text: 'The marketplace opens to approved sellers, with one checkout and per-seller shipping.' },
  { date: 'March 2026', title: 'Cash on delivery and live order tracking launch', text: 'Shoppers can pay on delivery and follow orders without creating an account.' },
];

const FACTS = [
  ['Founded', String(COMPANY.founded)],
  ['Headquarters', 'Karachi, Pakistan'],
  ['What we do', 'Online marketplace for everyday goods from approved independent sellers'],
  ['Payments', 'Card (Stripe), cash on delivery, store credit'],
];

const Press = () => (
  <InfoPage
    section="company"
    eyebrow="Press"
    title="News and media resources"
    lead={`For interviews, images and information, email ${COMPANY.pressEmail}. We reply within two business days.`}
  >
    <h2>Announcements</h2>
    <ul className="news-list">
      {NEWS.map((n) => (
        <li key={n.title}>
          <span>{n.date}</span>
          <h3>{n.title}</h3>
          <p>{n.text}</p>
        </li>
      ))}
    </ul>

    <h2>Fact sheet</h2>
    <dl className="facts">
      {FACTS.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>

    <h2>Brand</h2>
    <p>Write the name as <strong>TBVault</strong> (one word, capital T, B and V). Our accent color is vermilion <strong>#D63F12</strong> and our typeface is Manrope.</p>
    <p>Media contact: <a href={`mailto:${COMPANY.pressEmail}`}>{COMPANY.pressEmail}</a></p>
    <p className="info-note">Demo project: announcements are examples.</p>
  </InfoPage>
);

export default Press;
