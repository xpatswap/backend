const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { moveToEscrow, releaseEscrowToSeller } = require('../services/walletService');
const { generateOtp, hashOtp } = require('../utils/otp');

const MAX_HANDOFF_ATTEMPTS = 5;

const orderInclude = {
  listing: { select: { id: true, name: true, model: true, estimatedValue: true, guaranteeDays: true, guaranteeNote: true } },
  buyer: { select: { id: true, fullName: true, avatarUrl: true } },
  seller: { select: { id: true, fullName: true, avatarUrl: true } },
};

// POST /api/orders { listingId }
// Creates an order in AWAITING_PAYMENT - does not move any money yet.
const createOrder = asyncHandler(async (req, res) => {
  const { listingId } = req.body;
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw AppError.notFound('Listing not found.');
  if (!listing.published) throw AppError.badRequest('This listing is no longer available.');
  if (listing.sellerId === req.user.id) throw AppError.badRequest("You can't buy your own listing.");

  const order = await prisma.order.create({
    data: {
      listingId: listing.id,
      buyerId: req.user.id,
      sellerId: listing.sellerId,
      amount: listing.estimatedValue,
      status: 'AWAITING_PAYMENT',
    },
    include: orderInclude,
  });

  res.status(201).json({ success: true, data: order });
});

// POST /api/orders/:id/pay
// Moves the order amount from the buyer's spendable wallet into escrow.
// The buyer's money leaves their spendable balance immediately, but the
// SELLER cannot touch it yet - it only becomes spendable for the seller
// once the buyer confirms receipt.
const payForOrder = asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { listing: true } });
  if (!order) throw AppError.notFound('Order not found.');
  if (order.buyerId !== req.user.id) throw AppError.forbidden('This is not your order.');
  if (order.status !== 'AWAITING_PAYMENT') {
    throw AppError.badRequest(`This order can't be paid for - current status is ${order.status}.`, 'INVALID_ORDER_STATUS');
  }

  // The handoff code is generated now, hashed for storage, and returned ONCE
  // in this response — the buyer must save/screenshot it. It's never
  // retrievable in plaintext again after this (see getHandoffCode below),
  // matching how the OTP system handles email verification codes.
  const handoffCode = generateOtp();

  const updated = await prisma.$transaction(async (tx) => {
    // Re-check and flip status atomically inside the transaction: the
    // findUnique check above is for a fast, friendly error message, but
    // this updateMany with status: 'AWAITING_PAYMENT' in the WHERE clause
    // is what actually prevents two concurrent "Pay" requests (double-tap,
    // two open tabs, retried network request) from both succeeding and
    // double-charging the buyer. Only one can ever match and update.
    const claim = await tx.order.updateMany({
      where: { id: order.id, status: 'AWAITING_PAYMENT' },
      data: { status: 'PAID_IN_ESCROW', paidAt: new Date(), handoffCodeHash: hashOtp(handoffCode) },
    });
    if (claim.count === 0) {
      throw AppError.badRequest('This order was already paid for.', 'INVALID_ORDER_STATUS');
    }

    await moveToEscrow(
      tx,
      order.buyerId,
      order.amount,
      `Payment for ${order.listing.model} - held in escrow until handoff is confirmed`,
      order.sellerId
    );

    return tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
  });

  await prisma.notification.create({
    data: {
      userId: order.sellerId,
      type: 'SYSTEM',
      title: 'Payment received - in escrow',
      body: `A buyer paid N${order.amount.toLocaleString('en-NG')} for ${order.listing.model}. Funds are held until handoff is confirmed with their 6-digit code - please ship/deliver promptly.`,
      data: { orderId: order.id },
    },
  });
  req.app.get('io')?.to(`user:${order.sellerId}`).emit('order:paid', { orderId: order.id });

  // handoffCode is included in THIS response only — it is never stored in
  // plaintext or returned by any other endpoint.
  res.json({ success: true, data: { ...updated, handoffCode } });
});

// GET /api/orders/:id/handoff-code
// Lets the buyer re-view their own code later (e.g. they closed the payment
// confirmation before noting it down). Still never exposed to the seller —
// only the hash is checked against what the seller enters.
//
// IMPORTANT LIMITATION: since the code is stored hashed (one-way), this
// cannot actually recover a lost code — only the original payForOrder
// response can. This endpoint exists for future use if a reversible/short-TTL
// cache is added; today it correctly returns NOT_FOUND if called, with a
// clear explanation, rather than silently failing.
const getHandoffCode = asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw AppError.notFound('Order not found.');
  if (order.buyerId !== req.user.id) throw AppError.forbidden('Only the buyer can view this order\'s handoff code.');
  if (order.status !== 'PAID_IN_ESCROW') {
    throw AppError.badRequest('No active handoff code for this order.', 'NO_ACTIVE_CODE');
  }
  throw AppError.notFound(
    'Your handoff code was only shown once, right after payment, and cannot be recovered for security reasons. If you lost it, contact support through the order — they can verify your identity and help resolve the handoff another way.',
    'CODE_NOT_RECOVERABLE'
  );
});

// POST /api/orders/:id/release { code }
// THE critical fraud-prevention step, now strengthened: the SELLER enters the
// 6-digit code the BUYER was shown after payment. This proves the buyer
// physically handed over (or otherwise approved release for) the device —
// a seller can never release their own funds by guessing, and a stolen/
// brute-forced attempt is rate-limited and locks the order for admin review.
const releaseWithHandoffCode = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { listing: true } });
  if (!order) throw AppError.notFound('Order not found.');
  if (order.sellerId !== req.user.id) throw AppError.forbidden('Only the seller can enter the handoff code for this order.');
  if (order.status !== 'PAID_IN_ESCROW') {
    throw AppError.badRequest(`This order can't be released - current status is ${order.status}.`, 'INVALID_ORDER_STATUS');
  }
  if (!order.handoffCodeHash) {
    throw AppError.badRequest('No handoff code was generated for this order.', 'NO_HANDOFF_CODE');
  }
  if (order.handoffAttempts >= MAX_HANDOFF_ATTEMPTS) {
    throw AppError.badRequest(
      'Too many incorrect attempts. This order has been locked for admin review — contact support.',
      'HANDOFF_LOCKED'
    );
  }

  if (hashOtp(String(code)) !== order.handoffCodeHash) {
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { handoffAttempts: { increment: 1 } },
    });
    const remaining = MAX_HANDOFF_ATTEMPTS - updated.handoffAttempts;
    if (remaining <= 0) {
      await prisma.order.update({ where: { id: order.id }, data: { status: 'DISPUTED', disputedAt: new Date(), disputeReason: 'Too many incorrect handoff code attempts by seller.' } });
      throw AppError.badRequest('Too many incorrect attempts. This order has been locked and flagged for admin review.', 'HANDOFF_LOCKED');
    }
    throw AppError.badRequest(`That code doesn't match. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`, 'HANDOFF_CODE_MISMATCH');
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Atomically claim this order before touching any money: the status
    // checks above are for a fast, friendly error message, but this
    // updateMany with status: 'PAID_IN_ESCROW' in the WHERE clause is what
    // actually prevents two near-simultaneous correct-code submissions
    // (double-tap, retried request) from both releasing the same escrowed
    // funds. Only one can ever match and update; the second sees count: 0.
    const claim = await tx.order.updateMany({
      where: { id: order.id, status: 'PAID_IN_ESCROW' },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    if (claim.count === 0) {
      throw AppError.badRequest('This order was already released or is no longer awaiting release.', 'INVALID_ORDER_STATUS');
    }

    await releaseEscrowToSeller(
      tx,
      order.buyerId,
      order.sellerId,
      order.amount,
      `Released: handoff confirmed for ${order.listing.model}`
    );

    // If the seller had this exact physical device registered (IMEI), transfer
    // ownership to the buyer now — proven physical handoff, recorded
    // permanently in DeviceOwnershipTransfer. The device also un-links from
    // this listing (deviceId cleared) since the listing itself is now sold;
    // if the buyer relists it later, they can re-link it from their own
    // "My Devices."
    const listingWithDevice = await tx.listing.findUnique({ where: { id: order.listingId }, select: { deviceId: true } });
    if (listingWithDevice && listingWithDevice.deviceId) {
      const deviceId = listingWithDevice.deviceId;
      const device = await tx.device.findUnique({ where: { id: deviceId } });
      if (device && device.ownerId === order.sellerId) {
        await tx.device.update({
          where: { id: deviceId },
          data: { ownerId: order.buyerId },
        });
        await tx.deviceOwnershipTransfer.create({
          data: {
            deviceId,
            fromUserId: order.sellerId,
            toUserId: order.buyerId,
            orderId: order.id,
            reason: 'ORDER_RELEASED',
          },
        });
        await tx.listing.update({ where: { id: order.listingId }, data: { deviceId: null } });
      }
      // If the device was somehow no longer owned by the seller (edge case —
      // e.g. it was reassigned by admin in the meantime), skip the transfer
      // silently rather than failing the whole release; the sale itself still
      // completes correctly either way.
    }

    return tx.order.findUnique({ where: { id: order.id }, include: orderInclude });
  });

  await prisma.listing.update({ where: { id: order.listingId }, data: { swapsCount: { increment: 1 } } }).catch(() => {});

  await prisma.notification.create({
    data: {
      userId: order.sellerId,
      type: 'SYSTEM',
      title: 'Funds released to your wallet',
      body: `Handoff confirmed. N${order.amount.toLocaleString('en-NG')} has been added to your wallet balance.`,
      data: { orderId: order.id },
    },
  });
  await prisma.notification.create({
    data: {
      userId: order.buyerId,
      type: 'SYSTEM',
      title: 'Handoff confirmed',
      body: `Your purchase of ${order.listing.model} is complete — payment released to the seller.`,
      data: { orderId: order.id },
    },
  });
  req.app.get('io')?.to(`user:${order.sellerId}`).emit('order:released', { orderId: order.id });
  req.app.get('io')?.to(`user:${order.buyerId}`).emit('order:released', { orderId: order.id });

  res.json({ success: true, data: updated });
});

// POST /api/orders/:id/dispute { reason }
// Buyer raises an issue before confirming - freezes the order so the seller
// cannot somehow still get paid, and flags it for admin review.
const disputeOrder = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) throw AppError.badRequest('A reason is required to raise a dispute.');

  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw AppError.notFound('Order not found.');
  const isBuyer = order.buyerId === req.user.id;
  const isSeller = order.sellerId === req.user.id;
  if (!isBuyer && !isSeller) throw AppError.forbidden('You are not part of this order.');
  if (order.status !== 'PAID_IN_ESCROW') {
    throw AppError.badRequest(`This order can't be disputed - current status is ${order.status}.`, 'INVALID_ORDER_STATUS');
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: 'DISPUTED', disputedAt: new Date(), disputeReason: `[Raised by ${isBuyer ? 'buyer' : 'seller'}] ${reason}` },
    include: orderInclude,
  });

  await prisma.report.create({
    data: {
      reportingUserId: req.user.id,
      reportedUserId: isBuyer ? order.sellerId : order.buyerId,
      reason: `Order dispute: ${reason}`,
      details: `Order ${order.id}, amount N${order.amount}, raised by ${isBuyer ? 'buyer' : 'seller'}`,
    },
  });

  res.json({ success: true, data: { ...updated, message: 'Dispute raised. Funds remain held in escrow until our team reviews this.' } });
});

// POST /api/orders/:id/cancel (only before payment)
const cancelOrder = asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw AppError.notFound('Order not found.');
  if (order.buyerId !== req.user.id && order.sellerId !== req.user.id) {
    throw AppError.forbidden('You are not part of this order.');
  }
  if (order.status !== 'AWAITING_PAYMENT') {
    throw AppError.badRequest('Only unpaid orders can be cancelled directly - disputed or paid orders need admin review.', 'INVALID_ORDER_STATUS');
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
    include: orderInclude,
  });
  res.json({ success: true, data: updated });
});

// GET /api/orders/mine?role=buyer|seller
const listMyOrders = asyncHandler(async (req, res) => {
  const role = req.query.role === 'seller' ? 'seller' : 'buyer';
  const where = role === 'seller' ? { sellerId: req.user.id } : { buyerId: req.user.id };
  const orders = await prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ success: true, data: orders });
});

// GET /api/orders/:id
const getOrder = asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: orderInclude });
  if (!order) throw AppError.notFound('Order not found.');
  if (order.buyerId !== req.user.id && order.sellerId !== req.user.id) {
    throw AppError.forbidden('You are not part of this order.');
  }
  res.json({ success: true, data: order });
});

module.exports = {
  createOrder,
  payForOrder,
  getHandoffCode,
  releaseWithHandoffCode,
  disputeOrder,
  cancelOrder,
  listMyOrders,
  getOrder,
};
