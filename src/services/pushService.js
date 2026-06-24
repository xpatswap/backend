const webpush = require('web-push');
const prisma = require('../config/prisma');
const env = require('../config/env');

let configured = false;
function ensureConfigured() {
  if (configured) return;
  if (!env.vapid.publicKey || !env.vapid.privateKey) {
    console.warn('[push] VAPID keys not configured - background push notifications are disabled. See .env.example.');
    return;
  }
  webpush.setVapidDetails(`mailto:${env.vapid.contactEmail}`, env.vapid.publicKey, env.vapid.privateKey);
  configured = true;
}

// Sends a Web Push notification to every device a user has subscribed on.
// Silently no-ops if VAPID isn't configured, or the user has no subscriptions -
// this should never throw and block the calling code path (e.g. sending a
// chat message must succeed even if the push notification fails to send).
async function sendPushToUser(userId, { title, body, tag, url, threadId, communityId }) {
  ensureConfigured();
  if (!configured) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subscriptions.length) return;

  const payload = JSON.stringify({ title, body, tag, url, threadId, communityId });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.warn('[push] Failed to send to', sub.endpoint.slice(0, 50), '-', err.message);
        }
      }
    })
  );
}

module.exports = { sendPushToUser };
