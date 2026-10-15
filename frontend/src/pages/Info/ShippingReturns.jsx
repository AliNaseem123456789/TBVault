import { Link } from 'react-router-dom';
import InfoPage from './InfoPage';
import { useStoreConfig } from '../../features/store/useStoreConfig';

const money = (value) => `$${value}`;

/** Shipping rates come from the store's shipping zones (the same ones checkout charges). */
const ShippingReturns = () => {
  const config = useStoreConfig();
  const zones = config?.shipping_zones ?? [];
  const returnDays = config?.return_window_days ?? 30;

  return (
    <InfoPage
      section="support"
      eyebrow="Support"
      title="Shipping & returns"
      lead={`Shipping is charged once per order and shown at checkout before you pay. You have ${returnDays} days after delivery to return something.`}
    >
      <h2>Shipping rates</h2>
      <p>The cost depends on the delivery address. Coupons marked “free shipping” remove the charge.</p>
      {zones.length > 0 ? (
        <div className="table-scroll">
          <table className="zone-table">
            <thead>
              <tr><th scope="col">Zone</th><th scope="col">Covers</th><th scope="col">Rate</th><th scope="col">Free over</th></tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.name}>
                  <td>{z.name}</td>
                  <td>{z.is_default ? 'Everywhere else' : z.regions.join(', ')}</td>
                  <td>{Number(z.rate) > 0 ? money(z.rate) : 'Free'}</td>
                  <td>{z.free_over ? money(z.free_over) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="info-note">Shipping rates are shown at checkout once you enter your address.</p>
      )}

      <h2>Orders from several sellers</h2>
      <p>When your cart has items from different sellers, each seller packs and ships their own items, so one order can arrive in several packages. You still pay shipping once. Every package has its own status and tracking number on the order page.</p>

      <h2>Order statuses</h2>
      <ul>
        <li><strong>Pending</strong>: we have your order and the seller is preparing it.</li>
        <li><strong>Confirmed</strong>: the seller has accepted it.</li>
        <li><strong>Shipped</strong>: on its way, with a tracking number when the seller has one.</li>
        <li><strong>Delivered</strong>: it has arrived.</li>
        <li><strong>Cancelled</strong>: cancelled before it shipped.</li>
      </ul>
      <p>Signed in? See every order under <Link to="/orders">Orders</Link>. Checked out as a guest? Use <Link to="/track">Track order</Link>.</p>

      <h2>How to return something</h2>
      <ol>
        <li>Open the order and choose <strong>Request a return</strong> (available once it shows as Delivered).</li>
        <li>Pick the items and tell us why you're returning them.</li>
        <li>We review the request. If it's approved, send the items back as instructed.</li>
        <li>When the items arrive, we issue your refund.</li>
      </ol>

      <h2>Refunds</h2>
      <p>You get back what you paid for the returned items, after any order discount, plus their share of tax. The original shipping charge isn't refunded.</p>
      <ul>
        <li><strong>Card</strong> payments go back to the same card. Banks usually take 5 to 10 business days to show it.</li>
        <li><strong>Cash on delivery</strong> payments are refunded by us directly.</li>
        <li><strong>Store credit</strong> you used goes back to your balance straight away.</li>
      </ul>
      <p>We may offer the whole refund as store credit instead; store credit refunds are instant.</p>
    </InfoPage>
  );
};

export default ShippingReturns;
