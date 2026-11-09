'use strict';

const express = require('express');
const db = require('./db');
const { ApiError } = require('./validate');
const { limiter } = require('./ratelimit');
const { isSaas, PLANS } = require('./plans');
const { log } = require('./log');
const { requireUser } = require('./auth');

const router = express.Router();

function stripeEnabled() {
  return isSaas() && !!process.env.STRIPE_SECRET_KEY;
}

function getStripe() {
  if (!stripeEnabled()) return null;
  // Lazy require so self-host never needs the package at runtime if unused.
  const Stripe = require('stripe');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

router.get('/plans', (_req, res) => {
  res.json({
    mode: isSaas() ? 'saas' : 'selfhost',
    stripe: stripeEnabled(),
    plans: Object.keys(PLANS).map((id) => ({ id, ...PLANS[id] })),
  });
});

router.post('/checkout', requireUser, limiter(20, 60 * 60 * 1000), async (req, res, next) => {
  try {
    if (!stripeEnabled()) {
      throw new ApiError(400, 'billing_disabled', 'Billing is only available in SaaS mode with Stripe configured.');
    }
    const plan = String((req.body && req.body.plan) || 'pro');
    const priceMap = {
      pro: process.env.STRIPE_PRICE_PRO,
      team: process.env.STRIPE_PRICE_TEAM,
    };
    const priceId = priceMap[plan];
    if (!priceId) throw new ApiError(400, 'plan_invalid', 'Unknown or unconfigured plan.');

    const stripe = getStripe();
    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { userId: req.user.id, username: req.user.username },
        email: req.user.email || undefined,
      });
      customerId = customer.id;
      await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.user.id]);
    }

    const origin = String(process.env.APP_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: origin + '/app?billing=success',
      cancel_url: origin + '/pricing?billing=cancel',
      metadata: { userId: req.user.id, plan },
    });

    res.json({ url: session.url, id: session.id });
  } catch (err) {
    next(err);
  }
});

router.post('/portal', requireUser, limiter(20, 60 * 60 * 1000), async (req, res, next) => {
  try {
    if (!stripeEnabled()) {
      throw new ApiError(400, 'billing_disabled', 'Billing is only available in SaaS mode with Stripe configured.');
    }
    if (!req.user.stripe_customer_id) {
      throw new ApiError(400, 'no_customer', 'No Stripe customer on this account yet.');
    }
    const stripe = getStripe();
    const origin = String(process.env.APP_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: origin + '/app',
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

async function handleWebhook(req, res) {
  if (!stripeEnabled()) return res.status(400).json({ error: 'billing_disabled' });

  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody || req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );
  } catch (err) {
    log('error', 'stripe.webhook_invalid', { error: err.message });
    return res.status(400).send('Webhook Error');
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata && session.metadata.userId;
      const plan = (session.metadata && session.metadata.plan) || 'pro';
      if (userId) {
        await db.query('UPDATE users SET plan = $1, stripe_customer_id = COALESCE(stripe_customer_id, $2) WHERE id = $3', [
          plan,
          session.customer,
          userId,
        ]);
      }
    }
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await db.query(
        'UPDATE users SET plan = $1 WHERE stripe_customer_id = $2',
        ['free', sub.customer]
      );
    }
  } catch (err) {
    log('error', 'stripe.webhook_handler', { error: err.message });
  }

  res.json({ received: true });
}

module.exports = { router, handleWebhook, stripeEnabled };
