const prisma = require('../config/prisma');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const listNotifications = asyncHandler(async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data: notifications });
});

const markRead = asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user.id },
    data: { read: true },
  });
  res.json({ success: true, data: { message: 'Marked as read.' } });
});

const markAllRead = asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, read: false }, data: { read: true } });
  res.json({ success: true, data: { message: 'All notifications marked as read.' } });
});

// POST /api/notifications/push-subscribe
// Body is the standard Web Push subscription object the browser returns from
// pushManager.subscribe(): { endpoint, keys: { p256dh, auth } }
const savePushSubscription = asyncHandler(async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    throw AppError.badRequest('Invalid push subscription payload.', 'INVALID_PUSH_SUBSCRIPTION');
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: req.user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers['user-agent'] || null },
    create: { userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers['user-agent'] || null },
  });

  res.json({ success: true, data: { message: 'Push notifications enabled.' } });
});

// POST /api/notifications/push-unsubscribe  { endpoint }
const removePushSubscription = asyncHandler(async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user.id } });
  }
  res.json({ success: true, data: { message: 'Push notifications disabled.' } });
});

module.exports = { listNotifications, markRead, markAllRead, savePushSubscription, removePushSubscription };
