import Button from '../../components/ui/Button';
import Icon from '../../components/ui/Icon';

/** Where ProtectedRoute sends logged-in users who lack the role a page needs. */
const Unauthorized = () => (
  <div className="container" style={{ padding: 'var(--space-11) 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)' }}>
    <Icon name="shield" size={36} />
    <h1>You don't have access to this page</h1>
    <p style={{ color: 'var(--color-ink-muted)' }}>It's only available to store administrators.</p>
    <Button to="/">Back to the store</Button>
  </div>
);

export default Unauthorized;
