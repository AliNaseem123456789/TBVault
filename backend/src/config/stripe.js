import Stripe from "stripe"

// Card payments are switched on by setting STRIPE_SECRET_KEY. Without it the store
// still works with cash on delivery, and the card option is hidden in checkout.
let client = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

export const getStripe = () => client
export const isCardPaymentEnabled = () => Boolean(client)

// Tests swap in a stand-in client (Stripe's API isn't reachable from CI).
export const setStripeClient = (testClient) => {
    client = testClient
}

// Only used to verify webhook signatures, which needs no API key.
export const webhookVerifier = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_webhook_only")
