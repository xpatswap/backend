const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');

// ============================================================
// WALLET SERVICE - every balance change goes through here, always inside a
// transaction, always paired with a WalletTransaction ledger entry. Nothing
// in this app should ever do `prisma.user.update({ walletBalance: ... })`
// directly outside this file - that's how balances drift from their audit
// trail and become impossible to reconcile.
// ============================================================

// Credits a user's spendable wallet balance (e.g. after a successful deposit,
// or when escrow is released to a seller).
async function creditWallet(tx, userId, amount, type, description, relatedUserId = null) {
  if (amount <= 0) throw new Error('creditWallet amount must be positive');
  await tx.user.update({ where: { id: userId }, data: { walletBalance: { increment: amount } } });
  await tx.walletTransaction.create({
    data: { userId, amount, type, description, relatedUserId },
  });
}

// Debits a user's spendable wallet balance (e.g. paying for an order, or a payout).
// Throws if the balance would go negative - never allow overdraft.
//
// IMPORTANT: this uses updateMany with a balance >= amount condition baked
// into the WHERE clause, instead of a separate findUnique-then-update. That
// makes the check-and-decrement a single atomic database operation, closing
// a race condition where two concurrent requests (e.g. a double-tapped "Pay"
// button, or two open tabs) could otherwise both read a sufficient balance
// before either write commits, allowing the balance to go negative.
async function debitWallet(tx, userId, amount, type, description, relatedUserId = null) {
  if (amount <= 0) throw new Error('debitWallet amount must be positive');
  const result = await tx.user.updateMany({
    where: { id: userId, walletBalance: { gte: amount } },
    data: { walletBalance: { decrement: amount } },
  });
  if (result.count === 0) {
    throw AppError.badRequest('Insufficient wallet balance.', 'INSUFFICIENT_BALANCE');
  }
  await tx.walletTransaction.create({
    data: { userId, amount: -amount, type, description, relatedUserId },
  });
}

// Moves money from a buyer's spendable balance into their escrow balance -
// still "theirs" in the sense that it can be refunded, but no longer spendable,
// and not yet the seller's either.
async function moveToEscrow(tx, buyerId, amount, description, relatedUserId = null) {
  await debitWallet(tx, buyerId, amount, 'ESCROW_HOLD', description, relatedUserId);
  await tx.user.update({ where: { id: buyerId }, data: { escrowBalance: { increment: amount } } });
}

// Releases escrowed money: removes it from the buyer's escrow balance and
// credits the seller's spendable wallet. This is the ONLY path that should
// ever increase a seller's balance from an order.
async function releaseEscrowToSeller(tx, buyerId, sellerId, amount, description) {
  await tx.user.update({ where: { id: buyerId }, data: { escrowBalance: { decrement: amount } } });
  await tx.walletTransaction.create({
    data: { userId: buyerId, amount: -amount, type: 'ESCROW_RELEASE', description, relatedUserId: sellerId },
  });
  await creditWallet(tx, sellerId, amount, 'ESCROW_RELEASE', description, buyerId);
}

// Refunds escrowed money back to the buyer's spendable balance (e.g. admin
// resolves a dispute in the buyer's favor, or an order is cancelled after payment).
async function refundEscrowToBuyer(tx, buyerId, amount, description) {
  await tx.user.update({ where: { id: buyerId }, data: { escrowBalance: { decrement: amount } } });
  await creditWallet(tx, buyerId, amount, 'REFUND', description);
}

async function getWalletSummary(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { walletBalance: true, escrowBalance: true },
  });
  if (!user) throw AppError.notFound('User not found.');
  return { balance: user.walletBalance, escrowBalance: user.escrowBalance };
}

module.exports = {
  creditWallet,
  debitWallet,
  moveToEscrow,
  releaseEscrowToSeller,
  refundEscrowToBuyer,
  getWalletSummary,
};
