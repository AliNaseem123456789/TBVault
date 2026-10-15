import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';
import InfoPage from './InfoPage';
import { useCompany } from '../../content/company';

const VALUES = [
  { icon: 'shield', title: 'Sellers we vouch for', text: 'Every store is reviewed before it can list, and stores that let customers down are suspended.' },
  { icon: 'card', title: 'Pay the way you like', text: 'Card through Stripe, cash on delivery, or store credit. One checkout for every seller.' },
  { icon: 'truck', title: 'Nothing goes quiet', text: 'Each package has its own status and tracking, even for guests without an account.' },
  { icon: 'return', title: 'Fair returns', text: 'A clear return window, refunds back the way you paid, and instant store-credit refunds.' },
];

const About = () => {
  const company = useCompany();
  return (
    <InfoPage
      section="company"
      eyebrow="About us"
      title="A marketplace built on trust, not tricks."
      lead={`${company.name} brings independent stores together behind one careful checkout. Started in Karachi in ${company.founded}.`}
      actions={(
        <>
          <Button to="/shop">Start shopping</Button>
          <Button to="/sell" variant="ghost">Sell with us</Button>
        </>
      )}
    >
      <h2>Why we started</h2>
      <p>Buying from small online stores often means guessing: will it arrive, can I pay cash, what if it's wrong? We built {company.name} so shoppers get one reliable experience no matter which store they buy from, and so good independent sellers get a checkout, payments and order tracking without building their own.</p>

      <h2>What we stand for</h2>
      <div className="info-cards">
        {VALUES.map((v) => (
          <div key={v.title} className="info-card">
            <Icon name={v.icon} size={24} />
            <h3>{v.title}</h3>
            <p>{v.text}</p>
          </div>
        ))}
      </div>

      <h2>How it works</h2>
      <ol>
        <li><strong>Sellers apply</strong> and we approve their store before anything is listed.</li>
        <li><strong>You shop across stores</strong> with one cart and pay once.</li>
        <li><strong>Each seller ships their part</strong> and you follow every package from your order page.</li>
        <li><strong>We stay in the middle</strong> for payments, refunds and support.</li>
      </ol>

      <h2>Company details</h2>
      <p>
        {company.legalName}<br />
        {company.address.join(', ')}<br />
        <a href={`mailto:${company.email}`}>{company.email}</a> · {company.phone}
      </p>
      <p className="info-note">TBVault is a demo project. Company details on this site are placeholders.</p>
    </InfoPage>
  );
};

export default About;
