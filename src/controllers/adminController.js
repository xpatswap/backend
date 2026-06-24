const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { sendVendorApprovedEmail, sendVendorRejectedEmail } = require('../services/emailService');
const { creditWallet, debitWallet, releaseEscrowToSeller, refundEscrowToBuyer } = require('../services/walletService');

// POST /api/admin/login
const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) throw AppError.unauthorized('Invalid admin credentials.');

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) throw AppError.unauthorized('Invalid admin credentials.');

  const token = jwt.sign({ sub: admin.id, role: admin.role }, env.jwt.accessSecret, {
    expiresIn: '8h',
    audience: 'admin',
  });

  res.json({ success: true, data: { token, admin: { id: admin.id, fullName: admin.fullName, role: admin.role } } });
});

// GET /api/admin/vendors?status=PENDING
const listVendorApplications = asyncHandler(async (req, res) => {
  const status = req.query.status || 'PENDING';
  const vendors = await prisma.vendorProfile.findMany({
    where: { status },
    include: { user: { select: { id: true, fullName: true, email: true, phone: true, createdAt: true } } },
    orderBy: { submittedAt: 'asc' },
  });
  res.json({ success: true, data: vendors });
});

// GET /api/admin/vendors/:id
const getVendorApplication = asyncHandler(async (req, res) => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: req.params.id },
    include: { user: true },
  });
  if (!vendor) throw AppError.notFound('Vendor application not found.');
  res.json({ success: true, data: vendor });
});

// POST /api/admin/vendors/:id/approve
const approveVendor = asyncHandler(async (req, res) => {
  const vendor = await prisma.vendorProfile.update({
    where: { id: req.params.id },
    data: { status: 'APPROVED', reviewedBy: req.admin.id, reviewedAt: new Date(), rejectionReason: null },
    include: { user: true },
  });

  await prisma.notification.create({
    data: {
      userId: vendor.userId,
      type: 'VENDOR_APPROVED',
      title: 'Vendor account approved 🎉',
      body: `${vendor.businessName} is now a verified vendor on Xpatswap.`,
    },
  });

  await sendVendorApprovedEmail(vendor.user.email, vendor.businessName);

  res.json({ success: true, data: { message: 'Vendor approved.', vendor } });
});

// POST /api/admin/vendors/:id/reject  { reason }
const rejectVendor = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) throw AppError.badRequest('A rejection reason is required.');

  const vendor = await prisma.vendorProfile.update({
    where: { id: req.params.id },
    data: { status: 'REJECTED', reviewedBy: req.admin.id, reviewedAt: new Date(), rejectionReason: reason },
    include: { user: true },
  });

  await prisma.notification.create({
    data: {
      userId: vendor.userId,
      type: 'VENDOR_REJECTED',
      title: 'Vendor application update',
      body: reason,
    },
  });

  await sendVendorRejectedEmail(vendor.user.email, vendor.businessName, reason);

  res.json({ success: true, data: { message: 'Vendor application rejected.', vendor } });
});

// GET /api/admin/reports
const listReports = asyncHandler(async (req, res) => {
  const status = req.query.status || 'OPEN';
  const reports = await prisma.report.findMany({
    where: { status },
    include: {
      reportingUser: { select: { id: true, fullName: true, email: true } },
      reportedUser: { select: { id: true, fullName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: reports });
});

// PATCH /api/admin/reports/:id  { status }
const updateReportStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const report = await prisma.report.update({ where: { id: req.params.id }, data: { status } });
  res.json({ success: true, data: report });
});

// GET /api/admin/devices/stolen
// Every device currently flagged stolen, with its most recent location ping
// (if any) so admin can see where it last checked in.
const listStolenDevices = asyncHandler(async (req, res) => {
  const devices = await prisma.device.findMany({
    where: { status: 'STOLEN' },
    include: {
      owner: { select: { id: true, fullName: true, email: true, phone: true } },
      locationPings: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { reportedStolenAt: 'desc' },
  });

  res.json({
    success: true,
    data: devices.map((d) => ({
      id: d.id,
      imei: d.imei,
      brand: d.brand,
      model: d.model,
      reportedStolenAt: d.reportedStolenAt,
      owner: d.owner,
      lastPing: d.locationPings[0] || null,
      hasLocationData: !!(d.locationPings[0] && d.locationPings[0].latitude),
    })),
  });
});

// GET /api/admin/devices/:id/pings  -> full location history for one stolen device
const getDeviceLocationHistory = asyncHandler(async (req, res) => {
  const device = await prisma.device.findUnique({
    where: { id: req.params.id },
    include: { owner: { select: { id: true, fullName: true, email: true } } },
  });
  if (!device) throw AppError.notFound('Device not found.');

  const pings = await prisma.deviceLocationPing.findMany({
    where: { deviceId: device.id },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: { device, pings } });
});

// GET /api/admin/devices/stolen-searches
// Every time someone searched an IMEI that came back STOLEN — useful for admin
// to spot patterns (e.g. the same searcher repeatedly checking stolen IMEIs,
// which could indicate a fencing operation) and to follow up directly if needed.
const listStolenImeiSearches = asyncHandler(async (req, res) => {
  const searches = await prisma.deviceImeiSearchLog.findMany({
    where: { resultStatus: 'STOLEN' },
    include: {
      device: { include: { owner: { select: { id: true, fullName: true, email: true } } } },
      searchedBy: { select: { id: true, fullName: true, email: true, phone: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ success: true, data: searches });
});

// ============================================================
// PAYMENTS — deposit confirmation, payout processing, dispute resolution.
// All real money movement in MANUAL mode is admin-triggered here, after the
// admin has personally verified the bank transfer (deposits) or personally
// sent the transfer (payouts) using their own banking app.
// ============================================================

// GET /api/admin/deposits?status=PENDING
const listDeposits = asyncHandler(async (req, res) => {
  const status = req.query.status || 'PENDING';
  const deposits = await prisma.paymentDeposit.findMany({
    where: { status },
    include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ success: true, data: deposits });
});

// POST /api/admin/deposits/:id/confirm
// Admin has checked their bank account and seen the real transfer arrive —
// this credits the buyer's wallet and marks the deposit SUCCESSFUL.
const confirmDeposit = asyncHandler(async (req, res) => {
  const deposit = await prisma.paymentDeposit.findUnique({ where: { id: req.params.id } });
  if (!deposit) throw AppError.notFound('Deposit not found.');
  if (deposit.status !== 'PENDING') throw AppError.badRequest('This deposit has already been processed.');

  const updated = await prisma.$transaction(async (tx) => {
    // Atomically claim this deposit before crediting any money: without this,
    // an admin double-clicking "Confirm" (slow network, eager double-tap)
    // could credit the same real bank transfer to a user's wallet twice,
    // creating money that was never actually received. The updateMany with
    // status: 'PENDING' in the WHERE clause ensures only one confirmation
    // can ever succeed per deposit.
    const claim = await tx.paymentDeposit.updateMany({
      where: { id: deposit.id, status: 'PENDING' },
      data: { status: 'SUCCESSFUL', confirmedAt: new Date(), creditedByAdminId: req.admin.id },
    });
    if (claim.count === 0) {
      throw AppError.badRequest('This deposit has already been processed.', 'ALREADY_PROCESSED');
    }

    await creditWallet(tx, deposit.userId, deposit.amount, 'DEPOSIT', 'Wallet top-up confirmed by admin');
    return tx.paymentDeposit.findUnique({ where: { id: deposit.id } });
  });

  await prisma.notification.create({
    data: {
      userId: deposit.userId,
      type: 'SYSTEM',
      title: 'Wallet credited',
      body: `₦${deposit.amount.toLocaleString('en-NG')} has been added to your wallet.`,
    },
  });
  req.app.get('io')?.to(`user:${deposit.userId}`).emit('wallet:credited', { amount: deposit.amount });

  res.json({ success: true, data: updated });
});

// POST /api/admin/deposits/:id/reject { reason }
const rejectDeposit = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const deposit = await prisma.paymentDeposit.findUnique({ where: { id: req.params.id } });
  if (!deposit) throw AppError.notFound('Deposit not found.');
  if (deposit.status !== 'PENDING') throw AppError.badRequest('This deposit has already been processed.');

  const updated = await prisma.paymentDeposit.update({
    where: { id: deposit.id },
    data: { status: 'FAILED', note: reason || 'Could not verify transfer.' },
  });
  res.json({ success: true, data: updated });
});

// GET /api/admin/payouts?status=PENDING
const listPayouts = asyncHandler(async (req, res) => {
  const status = req.query.status || 'PENDING';
  const payouts = await prisma.payout.findMany({
    where: { status },
    include: { user: { select: { id: true, fullName: true, email: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ success: true, data: payouts });
});

// POST /api/admin/payouts/:id/mark-paid
// Admin has personally sent the bank transfer to the seller — this debits
// their wallet balance now (not earlier) so a seller's spendable balance
// stays accurate right up until the money has actually left.
const markPayoutPaid = asyncHandler(async (req, res) => {
  const payout = await prisma.payout.findUnique({ where: { id: req.params.id } });
  if (!payout) throw AppError.notFound('Payout not found.');
  if (payout.status !== 'PENDING' && payout.status !== 'PROCESSING') {
    throw AppError.badRequest('This payout has already been processed.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    await debitWallet(tx, payout.userId, payout.amount, 'PAYOUT', 'Withdrawal paid out by admin');
    return tx.payout.update({
      where: { id: payout.id },
      data: { status: 'PAID', processedAt: new Date(), processedByAdminId: req.admin.id },
    });
  });

  await prisma.notification.create({
    data: {
      userId: payout.userId,
      type: 'SYSTEM',
      title: 'Payout sent',
      body: `₦${payout.amount.toLocaleString('en-NG')} has been transferred to your bank account.`,
    },
  });

  res.json({ success: true, data: updated });
});

// POST /api/admin/payouts/:id/fail { reason }
const failPayout = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const payout = await prisma.payout.findUnique({ where: { id: req.params.id } });
  if (!payout) throw AppError.notFound('Payout not found.');
  if (payout.status !== 'PENDING' && payout.status !== 'PROCESSING') {
    throw AppError.badRequest('This payout has already been processed.');
  }
  const updated = await prisma.payout.update({
    where: { id: payout.id },
    data: { status: 'FAILED', failureReason: reason || 'Could not complete transfer.' },
  });
  res.json({ success: true, data: updated });
});

// GET /api/admin/orders?status=DISPUTED
const listOrders = asyncHandler(async (req, res) => {
  const status = req.query.status || 'DISPUTED';
  const orders = await prisma.order.findMany({
    where: { status },
    include: {
      listing: { select: { id: true, name: true, model: true, estimatedValue: true } },
      buyer: { select: { id: true, fullName: true, email: true, phone: true } },
      seller: { select: { id: true, fullName: true, email: true, phone: true } },
    },
    orderBy: { disputedAt: 'desc' },
  });
  res.json({ success: true, data: orders });
});

// POST /api/admin/orders/:id/resolve { resolution: "REFUND_BUYER" | "RELEASE_TO_SELLER" }
// The dispute resolution endpoint — admin reviews the chat/evidence outside
// this flow, then decides who was right and resolves accordingly.
const resolveDispute = asyncHandler(async (req, res) => {
  const { resolution } = req.body;
  if (!['REFUND_BUYER', 'RELEASE_TO_SELLER'].includes(resolution)) {
    throw AppError.badRequest('resolution must be REFUND_BUYER or RELEASE_TO_SELLER.');
  }

  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { listing: true } });
  if (!order) throw AppError.notFound('Order not found.');
  if (order.status !== 'DISPUTED') throw AppError.badRequest('Only disputed orders can be resolved this way.');

  const updated = await prisma.$transaction(async (tx) => {
    // Atomically claim the order before moving any money, same pattern as
    // confirmDeposit/payForOrder/releaseWithHandoffCode — without this, an
    // admin double-clicking "Resolve" could refund AND release the same
    // escrowed funds twice.
    const newStatus = resolution === 'REFUND_BUYER' ? 'REFUNDED' : 'RELEASED';
    const claim = await tx.order.updateMany({
      where: { id: order.id, status: 'DISPUTED' },
      data: { status: newStatus, ...(resolution === 'REFUND_BUYER' ? { refundedAt: new Date() } : { releasedAt: new Date() }) },
    });
    if (claim.count === 0) {
      throw AppError.badRequest('This dispute has already been resolved.', 'ALREADY_RESOLVED');
    }

    if (resolution === 'REFUND_BUYER') {
      await refundEscrowToBuyer(tx, order.buyerId, order.amount, `Admin resolved dispute in your favor — ${order.listing.model}`);
    } else {
      await releaseEscrowToSeller(tx, order.buyerId, order.sellerId, order.amount, `Admin resolved dispute in seller's favor — ${order.listing.model}`);
    }
    return tx.order.findUnique({ where: { id: order.id } });
  });

  const notifyUserId = resolution === 'REFUND_BUYER' ? order.buyerId : order.sellerId;
  await prisma.notification.create({
    data: {
      userId: notifyUserId,
      type: 'SYSTEM',
      title: 'Dispute resolved',
      body: resolution === 'REFUND_BUYER'
        ? `Your dispute was resolved in your favor. ₦${order.amount.toLocaleString('en-NG')} has been refunded to your wallet.`
        : `The dispute on your order was resolved in your favor. ₦${order.amount.toLocaleString('en-NG')} has been released to your wallet.`,
    },
  });

  res.json({ success: true, data: updated });
});

// GET /api/admin/payment-account
// Returns the Xpatswap bank account details configured in .env — used by the
// admin dashboard to display the account users should be paying into.
const getPaymentAccount = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      bankName: env.payments.manualBankName || '(not set — check MANUAL_BANK_NAME in .env)',
      accountNumber: env.payments.manualAccountNumber || '(not set — check MANUAL_ACCOUNT_NUMBER in .env)',
      accountName: env.payments.manualAccountName || '(not set — check MANUAL_ACCOUNT_NAME in .env)',
    },
  });
});

module.exports = {
  adminLogin,
  getPaymentAccount,
  listVendorApplications,
  getVendorApplication,
  approveVendor,
  rejectVendor,
  listReports,
  updateReportStatus,
  listStolenDevices,
  getDeviceLocationHistory,
  listStolenImeiSearches,
  listDeposits,
  confirmDeposit,
  rejectDeposit,
  listPayouts,
  markPayoutPaid,
  failPayout,
  listOrders,
  resolveDispute,
};
