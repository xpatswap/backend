const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { getWalletSummary } = require('../services/walletService');
const { getDepositInstructions } = require('../services/paymentProviderService');

const getMyWalletBalance = asyncHandler(async (req, res) => {
  const summary = await getWalletSummary(req.user.id);
  res.json({ success: true, data: summary });
});

const getMyWalletTransactions = asyncHandler(async (req, res) => {
  const transactions = await prisma.walletTransaction.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data: transactions });
});

// POST /api/wallet/deposits { amount }
// Creates a PENDING deposit request and returns instructions for how to pay.
// In MANUAL mode this is your business bank account; the buyer transfers
// outside the app, then the deposit shows up in the admin dashboard's queue
// to be manually confirmed and credited.
const requestDeposit = asyncHandler(async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 100) {
    throw AppError.badRequest('Minimum deposit is N100.', 'AMOUNT_TOO_LOW');
  }

  const deposit = await prisma.paymentDeposit.create({
    data: { userId: req.user.id, amount, status: 'PENDING' },
  });

  const instructions = getDepositInstructions(req.user);

  res.status(201).json({
    success: true,
    data: { depositId: deposit.id, amount: deposit.amount, ...instructions },
  });
});

const getMyDeposits = asyncHandler(async (req, res) => {
  const deposits = await prisma.paymentDeposit.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ success: true, data: deposits });
});

// POST /api/wallet/payouts { amount, bankAccountId }
// Seller requests a withdrawal to one of their pre-registered bank accounts.
// Only registered accounts (added at signup) can receive payouts — no
// arbitrary account numbers accepted.
const requestPayout = asyncHandler(async (req, res) => {
  const { amount, bankAccountId } = req.body;
  if (!amount || amount < 500) {
    throw AppError.badRequest('Minimum payout is ₦500.', 'AMOUNT_TOO_LOW');
  }
  if (!bankAccountId) {
    throw AppError.badRequest('Please select a registered bank account for this payout.', 'BANK_ACCOUNT_REQUIRED');
  }

  // Verify the bank account belongs to this user
  const bankAccount = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, userId: req.user.id },
  });
  if (!bankAccount) {
    throw AppError.badRequest('Bank account not found. You can only withdraw to your registered accounts.', 'INVALID_BANK_ACCOUNT');
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { walletBalance: true } });
  if (!user || user.walletBalance < amount) {
    throw AppError.badRequest('Insufficient wallet balance for this payout.', 'INSUFFICIENT_BALANCE');
  }

  const pendingTotal = await prisma.payout.aggregate({
    where: { userId: req.user.id, status: { in: ['PENDING', 'PROCESSING'] } },
    _sum: { amount: true },
  });
  const alreadyPending = pendingTotal._sum.amount || 0;
  if (user.walletBalance - alreadyPending < amount) {
    throw AppError.badRequest(
      `You already have ₦${alreadyPending.toLocaleString('en-NG')} in pending payout requests, which would leave insufficient balance for this one.`,
      'INSUFFICIENT_BALANCE'
    );
  }

  const payout = await prisma.payout.create({
    data: {
      userId: req.user.id,
      amount,
      bankName: bankAccount.bankName,
      accountNumber: bankAccount.accountNumber,
      accountName: bankAccount.accountName,
      status: 'PENDING',
    },
  });

  res.status(201).json({
    success: true,
    data: { ...payout, message: 'Payout requested. An admin will process this and the funds will be removed from your wallet once sent.' },
  });
});

// GET /api/wallet/bank-accounts — list user's registered bank accounts
const getMyBankAccounts = asyncHandler(async (req, res) => {
  const accounts = await prisma.bankAccount.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ success: true, data: accounts });
});

const getMyPayouts = asyncHandler(async (req, res) => {
  const payouts = await prisma.payout.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ success: true, data: payouts });
});

module.exports = {
  getMyWalletBalance,
  getMyWalletTransactions,
  requestDeposit,
  getMyDeposits,
  requestPayout,
  getMyPayouts,
  getMyBankAccounts,
};
