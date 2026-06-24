const prisma = require('../config/prisma');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const createReport = asyncHandler(async (req, res) => {
  const { reportedUserId, reportedListingId, reason, details } = req.body;
  if (!reportedUserId && !reportedListingId) {
    throw AppError.badRequest('Either reportedUserId or reportedListingId is required.');
  }
  if (!reason || !reason.trim()) throw AppError.badRequest('A reason is required.');

  const report = await prisma.report.create({
    data: {
      reportingUserId: req.user.id,
      reportedUserId: reportedUserId || null,
      reportedListingId: reportedListingId || null,
      reason,
      details: details || null,
    },
  });

  res.status(201).json({ success: true, data: { message: 'Report submitted. Our team will review it shortly.', report } });
});

module.exports = { createReport };
