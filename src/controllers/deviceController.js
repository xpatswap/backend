const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// Basic IMEI format check (15 digits) — not a full Luhn checksum validation,
// but enough to catch obvious typos before hitting the database.
function isValidImeiFormat(imei) {
  return /^[0-9]{15}$/.test(imei);
}

// POST /api/devices  { imei, brand?, model? }
// Registers a device to the current user's account.
const registerDevice = asyncHandler(async (req, res) => {
  const { imei, brand, model } = req.body;
  if (!isValidImeiFormat(imei)) {
    throw AppError.badRequest('IMEI must be exactly 15 digits.', 'INVALID_IMEI_FORMAT');
  }

  const existing = await prisma.device.findUnique({ where: { imei } });
  if (existing) {
    throw AppError.conflict('This IMEI is already registered to an account.', 'IMEI_ALREADY_REGISTERED');
  }

  const device = await prisma.$transaction(async (tx) => {
    const created = await tx.device.create({
      data: { imei, ownerId: req.user.id, brand: brand || null, model: model || null },
    });
    await tx.deviceOwnershipTransfer.create({
      data: { deviceId: created.id, fromUserId: null, toUserId: req.user.id, reason: 'INITIAL_REGISTRATION' },
    });
    return created;
  });

  res.status(201).json({ success: true, data: device });
});

// GET /api/devices/mine
const listMyDevices = asyncHandler(async (req, res) => {
  const devices = await prisma.device.findMany({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ success: true, data: devices });
});

// GET /api/devices/check/:imei  (public — the "IMEI checker")
// Anyone (e.g. a buyer considering a used phone) can check whether an IMEI has
// been reported stolen, without needing to know whose account it belongs to.
// optionalAuth middleware runs upstream, so req.user is set when the searcher
// is logged in (needed so we can warn/notify them directly when there's a hit).
const checkImei = asyncHandler(async (req, res) => {
  const { imei } = req.params;
  if (!isValidImeiFormat(imei)) {
    throw AppError.badRequest('IMEI must be exactly 15 digits.', 'INVALID_IMEI_FORMAT');
  }

  const device = await prisma.device.findUnique({
    where: { imei },
    include: { owner: { select: { id: true, fullName: true } } },
  });

  if (!device) {
    await prisma.deviceImeiSearchLog.create({
      data: { imei, searchedById: req.user ? req.user.id : null, resultStatus: 'UNKNOWN' },
    });
    return res.json({
      success: true,
      data: {
        imei, found: false, status: 'UNKNOWN',
        message: 'This IMEI is not registered on Xpatswap. This does not guarantee the device is clean — only that nobody has registered or reported it here.',
      },
    });
  }

  await prisma.deviceImeiSearchLog.create({
    data: { imei, deviceId: device.id, searchedById: req.user ? req.user.id : null, resultStatus: device.status },
  });

  if (device.status === 'STOLEN') {
    await notifyStolenImeiSearch(req.app, device, req.user);
  }

  res.json({
    success: true,
    data: {
      imei,
      found: true,
      status: device.status,
      brand: device.brand,
      model: device.model,
      reportedStolenAt: device.reportedStolenAt,
      owner: device.status === 'STOLEN' ? { id: device.owner.id, fullName: device.owner.fullName } : null,
      message:
        device.status === 'STOLEN'
          ? `This device has been reported STOLEN by its registered owner, ${device.owner.fullName}. Do not purchase this device. The owner and our review team have been notified of this search.`
          : device.status === 'RECOVERED'
            ? 'This device was previously reported stolen but has since been marked recovered by its owner.'
            : 'No stolen report found for this IMEI on Xpatswap.',
    },
  });
});

// Fires when an IMEI Checker search comes back STOLEN — notifies the device's
// owner (so they know someone may have spotted it / is being offered it), and
// logs it clearly for admin via the resultStatus on DeviceImeiSearchLog (surfaced
// through GET /api/admin/devices/stolen-searches). The searcher themselves is
// warned directly in the response body above (handled client-side), not via a
// stored Notification, since they may not even be a registered user.
async function notifyStolenImeiSearch(app, device, searcher) {
  await prisma.notification.create({
    data: {
      userId: device.ownerId,
      type: 'STOLEN_IMEI_SEARCHED',
      title: 'Someone checked your stolen device\'s IMEI',
      body: searcher
        ? `${searcher.fullName} looked up your device's IMEI on Xpatswap and was warned it's reported stolen.`
        : `Someone looked up your device's IMEI on Xpatswap and was warned it's reported stolen.`,
      data: { deviceId: device.id, searcherId: searcher ? searcher.id : null },
    },
  });

  const io = app.get('io');
  if (io) {
    io.to(`user:${device.ownerId}`).emit('device:stolen_imei_searched', {
      deviceId: device.id,
      imei: device.imei,
      searcher: searcher ? { id: searcher.id, fullName: searcher.fullName } : null,
      at: new Date().toISOString(),
    });
  }
}

// POST /api/devices/:id/report-stolen
// The registered owner reports their own device stolen. This is the trigger:
// from this point on, if the Xpatswap app is opened on that exact device by
// ANYONE (regardless of which account they're logged into), a location
// check-in fires automatically (see postLocationPing below) and admin is alerted.
const reportStolen = asyncHandler(async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) throw AppError.notFound('Device not found.');
  if (device.ownerId !== req.user.id) throw AppError.forbidden('You can only report your own registered devices stolen.');
  if (device.status === 'STOLEN') throw AppError.badRequest('This device is already marked as stolen.');

  const updated = await prisma.device.update({
    where: { id: device.id },
    data: { status: 'STOLEN', reportedStolenAt: new Date(), recoveredAt: null },
  });

  // Notify admins isn't a per-user notification (admins use a separate auth
  // namespace) — this is surfaced instead via GET /api/admin/devices/stolen.
  // We do still log an initial "report filed" ping with no location yet, so
  // the admin timeline shows exactly when the report came in.
  await prisma.deviceLocationPing.create({
    data: { deviceId: device.id, loggedInUserId: req.user.id },
  });

  // Broadcast a pinned alert into every state community, so members across
  // Nigeria can keep an eye out and help if they spot the device. The message
  // shows the IMEI and owner's name, and links through to the owner's profile.
  const alertResult = await broadcastStolenAlertToAllCommunities(req.app, req.user, updated);

  res.json({
    success: true,
    data: {
      message: `Device reported stolen and pinned to ${alertResult.count} community group${alertResult.count === 1 ? '' : 's'} nationwide. If the Xpatswap app is opened on this device again, its location will be sent to our review team when available.`,
      device: updated,
    },
  });
});

// Posts (and pins) a stolen-device alert message into every community in one go.
// Real-time delivery happens via the same socket room each community already
// uses for live chat (community:<id>), so members currently viewing a group see
// it appear instantly, pinned to the top.
async function broadcastStolenAlertToAllCommunities(app, reporter, device) {
  const communities = await prisma.community.findMany({ select: { id: true } });
  if (!communities.length) return { count: 0 };

  const alertText = `🚨 STOLEN DEVICE ALERT — IMEI ${device.imei} (${[device.brand, device.model].filter(Boolean).join(' ') || 'phone'}) was reported stolen by ${reporter.fullName}. If you come across this device, please reach out via their profile.`;

  const messages = await prisma.$transaction(
    communities.map((c) =>
      prisma.message.create({
        data: {
          senderId: null,
          communityId: c.id,
          type: 'STOLEN_DEVICE_ALERT',
          text: alertText,
          pinned: true,
          alertDeviceId: device.id,
        },
        include: { alertDevice: { select: { id: true, imei: true, brand: true, model: true, owner: { select: { id: true, fullName: true } } } } },
      })
    )
  );

  const io = app.get('io');
  if (io) {
    messages.forEach((m, i) => {
      io.to(`community:${communities[i].id}`).emit('community:pinned_alert', serializeStolenAlertMessage(m));
    });
  }

  return { count: communities.length };
}

function serializeStolenAlertMessage(m) {
  return {
    id: m.id,
    type: m.type,
    text: m.text,
    pinned: m.pinned,
    createdAt: m.createdAt,
    device: m.alertDevice
      ? {
          id: m.alertDevice.id,
          imei: m.alertDevice.imei,
          brand: m.alertDevice.brand,
          model: m.alertDevice.model,
          owner: m.alertDevice.owner,
        }
      : null,
  };
}

// POST /api/devices/:id/mark-recovered  (owner only)
const markRecovered = asyncHandler(async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) throw AppError.notFound('Device not found.');
  if (device.ownerId !== req.user.id) throw AppError.forbidden('You can only update your own registered devices.');

  const updated = await prisma.device.update({
    where: { id: device.id },
    data: { status: 'RECOVERED', recoveredAt: new Date() },
  });
  res.json({ success: true, data: updated });
});

// POST /api/devices/checkin  { imei, latitude?, longitude?, accuracyM? }
// Called automatically by the frontend on app open/foreground, passing whatever
// IMEI it can determine for the current device (if any — browsers can't reliably
// read a real hardware IMEI, see frontend notes). If that IMEI matches a STOLEN
// device record, this logs a location ping and notifies the owner + flags it for
// admin, regardless of which account is currently logged in on the device.
const deviceCheckin = asyncHandler(async (req, res) => {
  const { imei, latitude, longitude, accuracyM } = req.body;
  if (!imei || !isValidImeiFormat(imei)) {
    // Silently no-op on bad/missing IMEI — this endpoint is called passively
    // and should never surface an error to whoever is currently using the device.
    return res.json({ success: true, data: { tracked: false } });
  }

  const device = await prisma.device.findUnique({ where: { imei } });
  if (!device || device.status !== 'STOLEN') {
    return res.json({ success: true, data: { tracked: false } });
  }

  const ping = await prisma.deviceLocationPing.create({
    data: {
      deviceId: device.id,
      latitude: latitude || null,
      longitude: longitude || null,
      accuracyM: accuracyM || null,
      loggedInUserId: req.user ? req.user.id : null,
    },
  });

  await prisma.notification.create({
    data: {
      userId: device.ownerId,
      type: 'DEVICE_STOLEN_LOCATION',
      title: 'New location ping for your stolen device',
      body: latitude && longitude ? 'A location update was just received.' : 'Your stolen device was just opened, but location was not available.',
      data: { deviceId: device.id, pingId: ping.id },
    },
  });

  // tracked: true is intentionally still returned even when the device's current
  // user has no idea this is happening — the frontend should NOT surface this
  // response visibly so as not to tip off whoever has the stolen device.
  res.json({ success: true, data: { tracked: true } });
});

// GET /api/devices/:id/pings  (owner only — view the location trail for their own stolen device)
const getDevicePings = asyncHandler(async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) throw AppError.notFound('Device not found.');
  if (device.ownerId !== req.user.id) throw AppError.forbidden('You can only view pings for your own devices.');

  const pings = await prisma.deviceLocationPing.findMany({
    where: { deviceId: device.id },
    orderBy: { createdAt: 'desc' },
    take: 200, // a stolen device left unrecovered could accumulate many check-ins over time
  });
  res.json({ success: true, data: pings });
});

// GET /api/devices/:id/ownership-history
// Viewable by the current owner, or anyone who has ever owned this device
// (so a past owner who sold it can still confirm the chain of custody is
// intact, e.g. for dispute purposes).
const getOwnershipHistory = asyncHandler(async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) throw AppError.notFound('Device not found.');

  const everOwned = await prisma.deviceOwnershipTransfer.findFirst({
    where: { deviceId: device.id, OR: [{ fromUserId: req.user.id }, { toUserId: req.user.id }] },
  });
  if (device.ownerId !== req.user.id && !everOwned) {
    throw AppError.forbidden('You can only view ownership history for a device you currently or previously owned.');
  }

  const history = await prisma.deviceOwnershipTransfer.findMany({
    where: { deviceId: device.id },
    include: {
      fromUser: { select: { id: true, fullName: true } },
      toUser: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ success: true, data: history });
});

// GET /api/devices/:id/ownership-summary  (public — no auth required)
// What a prospective buyer sees BEFORE purchasing: how many legitimate
// owners this device has had and when, with no names at all. Full identity
// details stay restricted to people who have actually owned the device
// (see getOwnershipHistory above) — a buyer doesn't need or get past owners'
// names, just enough to judge the device's legitimacy and history length.
const getOwnershipSummary = asyncHandler(async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) throw AppError.notFound('Device not found.');

  const history = await prisma.deviceOwnershipTransfer.findMany({
    where: { deviceId: device.id },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, reason: true },
  });

  const registeredAt = history.length ? history[0].createdAt : device.createdAt;
  const transferCount = history.filter((h) => h.reason === 'ORDER_RELEASED' || h.reason === 'ADMIN_REASSIGNED').length;
  const lastTransferAt = transferCount > 0 ? history[history.length - 1].createdAt : null;

  res.json({
    success: true,
    data: {
      imei: device.imei,
      status: device.status,
      registeredAt,
      ownerCount: transferCount + 1, // the original registrant counts as the first owner
      lastTransferAt,
    },
  });
});

module.exports = {
  registerDevice,
  listMyDevices,
  checkImei,
  reportStolen,
  markRecovered,
  deviceCheckin,
  getDevicePings,
  getOwnershipHistory,
  getOwnershipSummary,
  isValidImeiFormat,
};
