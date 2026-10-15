import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/ui/Icon';
import InfoPage from './InfoPage';
import { useCompany } from '../../content/company';
import { useAuth } from '../../features/auth/AuthProvider';
import { getContactTopics, sendContactMessage } from '../../api/site.api';

const FALLBACK_TOPICS = ['Order help', 'Returns & refunds', 'Payments', 'Selling on TBVault', 'Something else'];

const Contact = () => {
  const company = useCompany();
  const { user } = useAuth();
  const [topics, setTopics] = useState(FALLBACK_TOPICS);
  // name/email stay null until typed in, so a signed-in customer's own details show by default.
  const [form, setForm] = useState({ name: null, email: null, topic: FALLBACK_TOPICS[0], order_ref: '', message: '' });
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [error, setError] = useState('');

  useEffect(() => {
    getContactTopics().then((res) => res?.data?.length && setTopics(res.data)).catch(() => {});
  }, []);

  const name = form.name ?? user?.name ?? '';
  const email = form.email ?? user?.email ?? '';

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setState('sending');
    setError('');
    try {
      await sendContactMessage({ ...form, name, email, order_ref: form.order_ref || undefined });
      setState('sent');
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't send your message. Please try again.");
      setState('error');
    }
  };

  return (
    <InfoPage
      section="support"
      eyebrow="Support"
      title="Contact us"
      lead="Send us a message and we'll reply by email within one business day. For the quickest answer about an order, include its number."
      wide
    >
      <div className="contact">
        <div className="contact__form card">
          {state === 'sent' ? (
            <div className="contact__sent" role="status">
              <Icon name="check" size={28} />
              <h2>Message sent</h2>
              <p>Thanks, {name.split(' ')[0]}. We'll reply to {email} within one business day.</p>
              <Link to="/" className="btn btn-ghost">Back to the shop</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate={false}>
              <div className="contact__row">
                <div className="field">
                  <label htmlFor="c-name">Your name</label>
                  <input id="c-name" className="input" required maxLength={100} value={name} onChange={update('name')} autoComplete="name" />
                </div>
                <div className="field">
                  <label htmlFor="c-email">Email</label>
                  <input id="c-email" className="input" type="email" required maxLength={255} value={email} onChange={update('email')} autoComplete="email" />
                </div>
              </div>
              <div className="contact__row">
                <div className="field">
                  <label htmlFor="c-topic">Topic</label>
                  <select id="c-topic" className="input" value={form.topic} onChange={update('topic')}>
                    {topics.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="c-order">Order number <span className="contact__optional">(optional)</span></label>
                  <input id="c-order" className="input" maxLength={40} value={form.order_ref} onChange={update('order_ref')} placeholder="e.g. 1042" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="c-message">Message</label>
                <textarea id="c-message" className="input" required minLength={10} maxLength={3000} rows={6} value={form.message} onChange={update('message')} />
              </div>
              {state === 'error' && <p className="form-alert form-alert-error" role="alert">{error}</p>}
              <button type="submit" className="btn btn-primary btn-lg" disabled={state === 'sending'}>
                {state === 'sending' ? 'Sending…' : 'Send message'}
              </button>
            </form>
          )}
        </div>

        <aside className="contact__details">
          <div className="info-card">
            <Icon name="send" size={22} />
            <h3>Email</h3>
            <p><a href={`mailto:${company.email}`}>{company.email}</a></p>
          </div>
          <div className="info-card">
            <Icon name="headset" size={22} />
            <h3>Phone</h3>
            <p>{company.phone}<br />{company.hours}</p>
          </div>
          <div className="info-card">
            <Icon name="pin" size={22} />
            <h3>Office</h3>
            <p>{company.address.map((line) => <span key={line}>{line}<br /></span>)}</p>
          </div>
          <p className="info-note">Looking for an order? <Link to="/track">Track it here</Link> or see the <Link to="/help">Help center</Link>.</p>
        </aside>
      </div>
    </InfoPage>
  );
};

export default Contact;
