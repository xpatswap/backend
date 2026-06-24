const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { uploadBuffer } = require('../services/storageService');
const { serializeMessage } = require('./communityController');
const { sendPushToUser } = require('../services/pushService');

// GET /api/threads -> the current user's full inbox, sorted by most recent activity
const listMyThreads = asyncHandler(async (req, res) => {
  const threads = await prisma.thread.findMany({
    where: { OR: [{ userAId: req.user.id }, { userBId: req.user.id }] },
    include: {
      userA: { select: { id: true, fullName: true, avatarUrl: true } },
      userB: { select: { id: true, fullName: true, avatarUrl: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { id: true, fullName: true } } } },
    },
    orderBy: { lastActivityAt: 'desc' },
    take: 200, // a very long-time, highly active user could otherwise have an unbounded number of conversations
  });

  // Unread counts for every thread are computed in a SINGLE grouped query
  // here, instead of one query per thread (the previous version ran a
  // separate prisma.message.count() inside a Promise.all map — an N+1 query
  // pattern that meant opening your inbox issued one query per conversation
  // you've ever had. groupBy collapses that to exactly one extra query
  // regardless of how many threads exist.
  const threadIds = threads.map((t) => t.id);
  const unreadGroups = threadIds.length
    ? await prisma.message.groupBy({
        by: ['threadId'],
        where: { threadId: { in: threadIds }, readAt: null, senderId: { not: req.user.id } },
        _count: true,
      })
    : [];
  const unreadByThread = new Map(unreadGroups.map((g) => [g.threadId, g._count]));

  const data = threads.map((t) => {
    const otherUser = t.userAId === req.user.id ? t.userB : t.userA;
    return {
      id: t.id,
      sourceType: t.sourceType,
      sourceLabel: t.sourceLabel,
      isSupport: t.sourceType === 'SUPPORT',
      otherUser: otherUser || { id: 'xpatswap-admin', fullName: 'Xpatswap Admin', avatarUrl: null },
      lastMessage: t.messages[0] ? serializeMessage(t.messages[0]) : null,
      unreadCount: unreadByThread.get(t.id) || 0,
      lastActivityAt: t.lastActivityAt,
    };
  });

  res.json({ success: true, data });
});

// GET /api/threads/:id/messages?before=<cursor>&limit=50
const getThreadMessages = asyncHandler(async (req, res) => {
  const thread = await prisma.thread.findUnique({ where: { id: req.params.id } });
  if (!thread) throw AppError.notFound('Thread not found.');
  if (thread.userAId !== req.user.id && thread.userBId !== req.user.id) {
    throw AppError.forbidden('You do not have access to this conversation.');
  }

  const { before } = req.query;
  const take = Math.min(Number(req.query.limit) || 50, 100);

  // Loads the most recent `take` messages (and older pages via `before`),
  // same pattern as community messages — an active 1:1 thread between two
  // long-time users could otherwise accumulate thousands of rows, all
  // fetched unconditionally on every single thread open.
  const messages = await prisma.message.findMany({
    where: { threadId: thread.id },
    include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
    take,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });

  await prisma.message.updateMany({
    where: { threadId: thread.id, senderId: { not: req.user.id }, readAt: null },
    data: { readAt: new Date() },
  });

  res.json({ success: true, data: messages.reverse().map(serializeMessage) });
});

async function getOrCreateSupportThread(userId) {
  let thread = await prisma.thread.findFirst({ where: { userAId: userId, sourceType: 'SUPPORT' } });
  if (!thread) {
    thread = await prisma.thread.create({
      data: { userAId: userId, userBId: null, sourceType: 'SUPPORT', sourceLabel: 'Xpatswap Admin' },
    });
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: null,
        type: 'TEXT',
        text: "Hi! I'm the Xpatswap Admin. I can help with disputes, fairness scores, reporting users, or anything group-related. What's going on?",
      },
    });
  }
  return thread;
}

// GET /api/threads/support -> always returns (creating if needed) the user's admin thread
const getSupportThread = asyncHandler(async (req, res) => {
  const thread = await getOrCreateSupportThread(req.user.id);
  res.json({ success: true, data: { threadId: thread.id } });
});

// POST /api/threads/from-listing-chat { listingId }
const startListingThread = asyncHandler(async (req, res) => {
  const { listingId } = req.body;
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw AppError.notFound('Listing not found.');
  if (listing.sellerId === req.user.id) throw AppError.badRequest("You can't start a chat about your own listing.");

  let thread = await prisma.thread.findFirst({
    where: { userAId: req.user.id, userBId: listing.sellerId, sourceType: 'LISTING_CHAT', relatedListingId: listingId },
  });

  if (!thread) {
    thread = await prisma.thread.create({
      data: {
        userAId: req.user.id,
        userBId: listing.sellerId,
        sourceType: 'LISTING_CHAT',
        sourceLabel: `RE: ${listing.model}`,
        relatedListingId: listingId,
      },
    });
    await prisma.message.create({
      data: { threadId: thread.id, senderId: listing.sellerId, type: 'TEXT', text: `Hey! Saw you're interested in my ${listing.model}.` },
    });
  }

  res.json({ success: true, data: { threadId: thread.id } });
});

// POST /api/threads/from-group-reply { communityMessageId, replyText }
const startGroupReplyThread = asyncHandler(async (req, res) => {
  const { communityMessageId, replyText } = req.body;
  if (!replyText || !replyText.trim()) throw AppError.badRequest('Reply text is required.');

  const original = await prisma.message.findUnique({
    where: { id: communityMessageId },
    include: { sender: true, community: true },
  });
  if (!original || !original.communityId) throw AppError.notFound('Original group message not found.');
  if (!original.senderId) throw AppError.badRequest('Cannot reply privately to a system message.');
  if (original.senderId === req.user.id) throw AppError.badRequest("You can't reply privately to your own message.");

  let thread = await prisma.thread.findFirst({
    where: {
      userAId: req.user.id,
      userBId: original.senderId,
      sourceType: 'GROUP_REPLY',
      relatedCommunityId: original.communityId,
    },
  });

  if (!thread) {
    thread = await prisma.thread.create({
      data: {
        userAId: req.user.id,
        userBId: original.senderId,
        sourceType: 'GROUP_REPLY',
        sourceLabel: original.community.state,
        relatedCommunityId: original.communityId,
      },
    });
  }

  await prisma.message.create({
    data: {
      threadId: thread.id,
      senderId: null,
      type: 'SYSTEM',
      quotedSenderName: original.sender.fullName,
      quotedText: original.text || (original.type === 'IMAGE' ? 'Sent a photo' : original.type === 'VOICE' ? 'Voice note' : ''),
      quotedCommunityId: original.communityId,
    },
  });

  const replyMsg = await prisma.message.create({
    data: { threadId: thread.id, senderId: req.user.id, type: 'TEXT', text: replyText },
  });

  await prisma.thread.update({ where: { id: thread.id }, data: { lastActivityAt: new Date() } });

  req.app.get('io')?.to(`user:${original.senderId}`).emit('thread:new_message', { threadId: thread.id, message: serializeMessage(replyMsg) });
  sendPushToUser(original.senderId, {
    title: `${req.user.fullName} (private reply)`,
    body: replyText.length > 100 ? replyText.slice(0, 97) + '...' : replyText,
    tag: `thread-${thread.id}`,
    url: './index.html',
    threadId: thread.id,
  }).catch(() => {});

  res.status(201).json({ success: true, data: { threadId: thread.id, message: serializeMessage(replyMsg) } });
});

// POST /api/threads/:id/messages (text)
const postThreadMessage = asyncHandler(async (req, res) => {
  const thread = await prisma.thread.findUnique({ where: { id: req.params.id } });
  if (!thread) throw AppError.notFound('Thread not found.');
  if (thread.userAId !== req.user.id && thread.userBId !== req.user.id) {
    throw AppError.forbidden('You do not have access to this conversation.');
  }

  const { text } = req.body;
  if (!text || !text.trim()) throw AppError.badRequest('Message text is required.');

  const message = await prisma.message.create({
    data: { threadId: thread.id, senderId: req.user.id, type: 'TEXT', text },
    include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
  });

  await prisma.thread.update({ where: { id: thread.id }, data: { lastActivityAt: new Date() } });

  const recipientId = thread.userAId === req.user.id ? thread.userBId : thread.userAId;
  if (recipientId) {
    req.app.get('io')?.to(`user:${recipientId}`).emit('thread:new_message', { threadId: thread.id, message: serializeMessage(message) });
    // Real-time socket delivery covers the case where the recipient has the app
    // open; Web Push additionally reaches them while backgrounded/locked. Fired
    // without awaiting so a slow/failed push never delays the chat response.
    sendPushToUser(recipientId, {
      title: req.user.fullName,
      body: text.length > 100 ? text.slice(0, 97) + '...' : text,
      tag: `thread-${thread.id}`,
      url: './index.html',
      threadId: thread.id,
    }).catch(() => {});
  } else if (thread.sourceType === 'SUPPORT') {
    setTimeout(async () => {
      const autoReply = await prisma.message.create({
        data: { threadId: thread.id, senderId: null, type: 'TEXT', text: 'Got it - flagging this for our team now. We will follow up here shortly.' },
      });
      req.app.get('io')?.to(`user:${req.user.id}`).emit('thread:new_message', { threadId: thread.id, message: serializeMessage(autoReply) });
    }, 1200);
  }

  res.status(201).json({ success: true, data: serializeMessage(message) });
});

// POST /api/threads/:id/messages/media (multipart: file, type=IMAGE|VOICE)
const postThreadMediaMessage = asyncHandler(async (req, res) => {
  const thread = await prisma.thread.findUnique({ where: { id: req.params.id } });
  if (!thread) throw AppError.notFound('Thread not found.');
  if (thread.userAId !== req.user.id && thread.userBId !== req.user.id) {
    throw AppError.forbidden('You do not have access to this conversation.');
  }
  if (!req.file) throw AppError.badRequest('No file uploaded.');

  const isAudio = req.file.mimetype.startsWith('audio/');
  const url = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype, 'chat-media');

  const message = await prisma.message.create({
    data: {
      threadId: thread.id,
      senderId: req.user.id,
      type: isAudio ? 'VOICE' : 'IMAGE',
      mediaUrl: url,
      voiceDurationSec: isAudio ? Number(req.body.durationSec) || null : null,
    },
    include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
  });

  await prisma.thread.update({ where: { id: thread.id }, data: { lastActivityAt: new Date() } });

  const recipientId = thread.userAId === req.user.id ? thread.userBId : thread.userAId;
  if (recipientId) {
    req.app.get('io')?.to(`user:${recipientId}`).emit('thread:new_message', { threadId: thread.id, message: serializeMessage(message) });
    sendPushToUser(recipientId, {
      title: req.user.fullName,
      body: isAudio ? '🎤 Sent a voice note' : '📷 Sent a photo',
      tag: `thread-${thread.id}`,
      url: './index.html',
      threadId: thread.id,
    }).catch(() => {});
  }

  res.status(201).json({ success: true, data: serializeMessage(message) });
});

// POST /api/threads/:id/location { latitude, longitude, accuracyM }
const postThreadLocation = asyncHandler(async (req, res) => {
  const thread = await prisma.thread.findUnique({ where: { id: req.params.id } });
  if (!thread) throw AppError.notFound('Thread not found.');
  if (thread.userAId !== req.user.id && thread.userBId !== req.user.id) {
    throw AppError.forbidden('You do not have access to this conversation.');
  }

  const { latitude, longitude, accuracyM } = req.body;
  const message = await prisma.message.create({
    data: {
      threadId: thread.id,
      senderId: req.user.id,
      type: 'LOCATION',
      latitude,
      longitude,
      locationAccuracyM: accuracyM || null,
    },
    include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
  });

  await prisma.thread.update({ where: { id: thread.id }, data: { lastActivityAt: new Date() } });

  res.status(201).json({ success: true, data: serializeMessage(message) });
});

module.exports = {
  listMyThreads,
  getThreadMessages,
  getSupportThread,
  startListingThread,
  startGroupReplyThread,
  postThreadMessage,
  postThreadMediaMessage,
  postThreadLocation,
  getOrCreateSupportThread,
};
