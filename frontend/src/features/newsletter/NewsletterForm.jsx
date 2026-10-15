import { useId, useState } from 'react';
import { subscribeNewsletter } from '../../api/site.api';
import './NewsletterForm.css';

/**
 * Email sign-up used in the footer and on the homepage.
 * `tone="dark"` for dark backgrounds (the footer).
 */
const NewsletterForm = ({ tone = 'light', buttonLabel = 'Subscribe' }) => {
  const inputId = useId();
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setState('sending');
    setError('');
    try {
      await subscribeNewsletter(email);
      setState('done');
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't sign you up. Please try again.");
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <p className={`newsletter-form__done newsletter-form--${tone}`} role="status">
        You're on the list. Watch your inbox for drops and deals.
      </p>
    );
  }

  return (
    <form className={`newsletter-form newsletter-form--${tone}`} onSubmit={handleSubmit}>
      <label htmlFor={inputId} className="visually-hidden">Email address</label>
      <input
        id={inputId}
        type="email"
        required
        placeholder="you@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
        {state === 'sending' ? 'Signing up…' : buttonLabel}
      </button>
      {state === 'error' && <p className="newsletter-form__error" role="alert">{error}</p>}
    </form>
  );
};

export default NewsletterForm;
