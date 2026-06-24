// ============================================================
// PAYMENT PROVIDER ABSTRACTION
//
// Today this runs in MANUAL mode: admin confirms a real bank transfer
// happened (outside the app, by checking their bank app) and credits the
// buyer's wallet through the admin dashboard. No real money moves through
// code yet - this is the safe, honest state until a licensed provider
// (Paystack, Flutterwave) is wired in.
//
// To go live with real payments later: implement initiateDeposit() and
// initiatePayout() below to call the real provider's API, and add a webhook
// route that calls confirmDepositFromWebhook() when their callback fires.
// Nothing in the controllers or wallet service needs to change.
// ============================================================

const env = require('../config/env');

function getActiveProvider() {
  return env.payments.provider || 'MANUAL';
}

// Returns the bank details a buyer should see/transfer to. In MANUAL mode,
// this is your own business bank account (set in .env) since there's no
// per-user virtual account yet. Once Paystack Dedicated Virtual Accounts (or
// similar) is wired in, this would instead create/fetch a unique account
// number per user.
function getDepositInstructions(user) {
  const provider = getActiveProvider();
  if (provider === 'MANUAL') {
    return {
      provider: 'MANUAL',
      instructions: `Transfer the amount to Xpatswap's account below, then tap "I've paid" and an admin will confirm and credit your wallet - usually within a few minutes during business hours.`,
      bankName: env.payments.manualBankName,
      accountNumber: env.payments.manualAccountNumber,
      accountName: env.payments.manualAccountName,
      reference: `XP-${user.id.slice(0, 8).toUpperCase()}`,
    };
  }
  throw new Error(`Payment provider "${provider}" is not yet implemented. Currently only MANUAL mode is active.`);
}

// Initiates a payout to a seller's bank account. In MANUAL mode this just
// returns a "pending admin action" marker - the admin dashboard shows it in
// a queue and an admin sends the real transfer themselves, then marks it paid.
async function initiatePayout({ amount, bankName, accountNumber, accountName }) {
  const provider = getActiveProvider();
  if (provider === 'MANUAL') {
    return { status: 'PENDING', providerReference: null, requiresManualAction: true };
  }
  throw new Error(`Payment provider "${provider}" is not yet implemented for payouts.`);
}

module.exports = { getActiveProvider, getDepositInstructions, initiatePayout };
