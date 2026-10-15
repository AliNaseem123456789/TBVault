import Icon from '../../components/ui/Icon';
import InfoPage from './InfoPage';
import { COMPANY } from '../../content/company';

// Demo openings: this is a demo project.
const OPENINGS = [
  { title: 'Frontend Engineer (React)', team: 'Engineering', where: 'Karachi or remote (Pakistan)', type: 'Full time' },
  { title: 'Customer Support Lead', team: 'Support', where: 'Karachi', type: 'Full time' },
  { title: 'Seller Success Associate', team: 'Marketplace', where: 'Karachi', type: 'Full time' },
  { title: 'Data Analyst', team: 'Growth', where: 'Remote (Pakistan)', type: 'Contract, 6 months' },
];

const PERKS = [
  { icon: 'wallet', title: 'Store credit every month', text: 'Spend it on anything in the marketplace.' },
  { icon: 'headset', title: 'Flexible hours', text: 'Core hours 12 to 4; the rest is up to you.' },
  { icon: 'star', title: 'Learning budget', text: 'Courses, books and conferences you choose.' },
];

const Careers = () => (
  <InfoPage
    section="company"
    eyebrow="Careers"
    title="Help us build the marketplace people trust."
    lead="We're a small team in Karachi working on payments, logistics and the tools our sellers use every day."
  >
    <h2>Open roles</h2>
    <ul className="job-list">
      {OPENINGS.map((job) => (
        <li key={job.title} className="job">
          <div>
            <h3>{job.title}</h3>
            <p>{job.team} · {job.where} · {job.type}</p>
          </div>
          <a
            className="btn btn-ghost btn-sm"
            href={`mailto:${COMPANY.careersEmail}?subject=${encodeURIComponent(`Application: ${job.title}`)}`}
          >
            Apply
          </a>
        </li>
      ))}
    </ul>

    <h2>Working here</h2>
    <div className="info-cards">
      {PERKS.map((p) => (
        <div key={p.title} className="info-card">
          <Icon name={p.icon} size={24} />
          <h3>{p.title}</h3>
          <p>{p.text}</p>
        </div>
      ))}
    </div>

    <h2>Don't see your role?</h2>
    <p>Send a short note about what you'd like to work on to <a href={`mailto:${COMPANY.careersEmail}`}>{COMPANY.careersEmail}</a>.</p>
    <p className="info-note">Demo project: these openings are examples.</p>
  </InfoPage>
);

export default Careers;
