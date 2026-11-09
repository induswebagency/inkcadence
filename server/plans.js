'use strict';

// Plan limits used by both self-host (env overrides) and SaaS (Stripe plan).
const PLANS = {
  free: {
    maxPacks: Number(process.env.MAX_PACKS_PER_USER || 10),
    neuralTrainMinutes: 0,
    exportCapPerDay: 50,
  },
  pro: {
    maxPacks: Number(process.env.MAX_PACKS_PRO || 50),
    neuralTrainMinutes: 120,
    exportCapPerDay: 500,
  },
  team: {
    maxPacks: Number(process.env.MAX_PACKS_TEAM || 200),
    neuralTrainMinutes: 600,
    exportCapPerDay: 5000,
  },
};

function planFor(user) {
  const name = (user && user.plan) || 'free';
  return PLANS[name] || PLANS.free;
}

function isSaas() {
  return String(process.env.DEPLOY_MODE || 'selfhost').toLowerCase() === 'saas';
}

module.exports = { PLANS, planFor, isSaas };
