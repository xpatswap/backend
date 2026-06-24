const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/calls { receiverId, type: "VOICE"|"VIDEO", threadId? }
// Actual audio/video connects peer-to-peer via WebRTC; this just creates the call
// record and pushes a real-time "incoming call" event to the receiver's socket.
const initiateCall = asyncHandler(async (req, res) => {
  const { receiverId, type, threadId } = req.body;
  if (receiverId === req.user.id) throw AppError.badRequest("You can't call yourself.");

  const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
  if (!receiver) throw AppError.notFound('Recipient not found.');

  const call = await prisma.call.create({
    data: { callerId: req.user.id, receiverId, type, status: 'RINGING', threadId: threadId || null },
  });

  req.app.get('io')?.to(`user:${receiverId}`).emit('call:incoming', {
    callId: call.id,
    type,
    caller: { id: req.user.id, fullName: req.user.fullName },
  });

  res.status(201).json({ success: true, data: call });
});

// PATCH /api/calls/:id/status { status: CONNECTED|DECLINED|MISSED|ENDED }
const updateCallStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const call = await prisma.call.findUnique({ where: { id: req.params.id } });
  if (!call) throw AppError.notFound('Call not found.');
  if (call.callerId !== req.user.id && call.receiverId !== req.user.id) {
    throw AppError.forbidden('You are not part of this call.');
  }

  const data = { status };
  if (status === 'CONNECTED') data.connectedAt = new Date();
  if (status === 'ENDED' || status === 'DECLINED' || status === 'MISSED') {
    data.endedAt = new Date();
    if (call.connectedAt) {
      data.durationSec = Math.round((Date.now() - call.connectedAt.getTime()) / 1000);
    }
  }

  const updated = await prisma.call.update({ where: { id: req.params.id }, data });

  if (updated.threadId && status === 'ENDED' && updated.connectedAt) {
    await prisma.message.create({
      data: {
        threadId: updated.threadId,
        senderId: null,
        type: 'CALL_LOG',
        text: `${updated.type === 'VIDEO' ? 'Video' : 'Voice'} call - ${updated.durationSec}s`,
      },
    });
  }

  const otherUserId = call.callerId === req.user.id ? call.receiverId : call.callerId;
  req.app.get('io')?.to(`user:${otherUserId}`).emit('call:status_changed', { callId: call.id, status });

  res.json({ success: true, data: updated });
});

// GET /api/calls/history
const getCallHistory = asyncHandler(async (req, res) => {
  const calls = await prisma.call.findMany({
    where: { OR: [{ callerId: req.user.id }, { receiverId: req.user.id }] },
    include: {
      caller: { select: { id: true, fullName: true, avatarUrl: true } },
      receiver: { select: { id: true, fullName: true, avatarUrl: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data: calls });
});

module.exports = { initiateCall, updateCallStatus, getCallHistory };
