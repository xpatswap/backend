const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { uploadBuffer } = require('../services/storageService');

const messageInclude = {
  sender: { select: { id: true, fullName: true, avatarUrl: true } },
  sharedListing: { select: { id: true, name: true, model: true, estimatedValue: true } },
  alertDevice: { select: { id: true, imei: true, brand: true, model: true, owner: { select: { id: true, fullName: true } } } },
};

function serializeMessage(m) {
  return {
    id: m.id,
    type: m.type,
    text: m.text,
    mediaUrl: m.mediaUrl,
    voiceDurationSec: m.voiceDurationSec,
    latitude: m.latitude,
    longitude: m.longitude,
    locationAccuracyM: m.locationAccuracyM,
    sharedListing: m.sharedListing,
    quotedSenderName: m.quotedSenderName,
    quotedText: m.quotedText,
    sender: m.sender,
    pinned: !!m.pinned,
    device: m.alertDevice
      ? {
          id: m.alertDevice.id,
          imei: m.alertDevice.imei,
          brand: m.alertDevice.brand,
          model: m.alertDevice.model,
          owner: m.alertDevice.owner,
        }
      : null,
    createdAt: m.createdAt,
  };
}

// GET /api/communities  -> all 37 state groups with live member counts
const listCommunities = asyncHandler(async (req, res) => {
  const communities = await prisma.community.findMany({
    include: {
      _count: { select: { members: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, include: messageInclude },
    },
    orderBy: { state: 'asc' },
  });

  res.json({
    success: true,
    data: communities.map((c) => ({
      id: c.id,
      state: c.state,
      region: c.region,
      memberCount: c._count.members,
      lastMessage: c.messages[0] ? serializeMessage(c.messages[0]) : null,
    })),
  });
});

// POST /api/communities/:id/join
const joinCommunity = asyncHandler(async (req, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.params.id } });
  if (!community) throw AppError.notFound('Community not found.');

  await prisma.communityMember.upsert({
    where: { communityId_userId: { communityId: community.id, userId: req.user.id } },
    update: {},
    create: { communityId: community.id, userId: req.user.id },
  });

  res.json({ success: true, data: { message: `Joined ${community.state}.` } });
});

// GET /api/communities/:id/messages?before=<cursor>&limit=50
const getCommunityMessages = asyncHandler(async (req, res) => {
  const { before, limit } = req.query;
  const take = Math.min(Number(limit) || 50, 100);

  const [messages, pinnedMessages] = await Promise.all([
    prisma.message.findMany({
      where: { communityId: req.params.id, pinned: false },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    }),
    // Pinned alerts (e.g. stolen-device broadcasts) are fetched separately and
    // unpaginated so they always render at the top of the chat, regardless of
    // how far back the regular message history has scrolled.
    prisma.message.findMany({
      where: { communityId: req.params.id, pinned: true },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  res.json({
    success: true,
    data: {
      messages: messages.reverse().map(serializeMessage),
      pinned: pinnedMessages.map(serializeMessage),
    },
  });
});

// POST /api/communities/:id/messages  (text)
const postCommunityMessage = asyncHandler(async (req, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.params.id } });
  if (!community) throw AppError.notFound('Community not found.');

  const { text, sharedListingId } = req.body;
  if (!text && !sharedListingId) throw AppError.badRequest('Message text or a shared listing is required.');

  const message = await prisma.message.create({
    data: {
      senderId: req.user.id,
      communityId: community.id,
      type: sharedListingId ? 'LISTING_SHARE' : 'TEXT',
      text: text || null,
      sharedListingId: sharedListingId || null,
    },
    include: messageInclude,
  });

  // Real-time fan-out happens via the socket layer (see sockets/communitySocket.js),
  // which calls this same controller logic internally via an emit hook in server.js.
  req.app.get('io')?.to(`community:${community.id}`).emit('community:new_message', serializeMessage(message));

  res.status(201).json({ success: true, data: serializeMessage(message) });
});

// POST /api/communities/:id/messages/media  (multipart: file=image|audio, type=IMAGE|VOICE)
const postCommunityMediaMessage = asyncHandler(async (req, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.params.id } });
  if (!community) throw AppError.notFound('Community not found.');
  if (!req.file) throw AppError.badRequest('No file uploaded.');

  const isAudio = req.file.mimetype.startsWith('audio/');
  const url = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype, 'chat-media');

  const message = await prisma.message.create({
    data: {
      senderId: req.user.id,
      communityId: community.id,
      type: isAudio ? 'VOICE' : 'IMAGE',
      mediaUrl: url,
      voiceDurationSec: isAudio ? Number(req.body.durationSec) || null : null,
    },
    include: messageInclude,
  });

  req.app.get('io')?.to(`community:${community.id}`).emit('community:new_message', serializeMessage(message));

  res.status(201).json({ success: true, data: serializeMessage(message) });
});

module.exports = {
  listCommunities,
  joinCommunity,
  getCommunityMessages,
  postCommunityMessage,
  postCommunityMediaMessage,
  serializeMessage,
};
