const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { uploadBuffer } = require('../services/storageService');

// Same forgiving-but-strict name matching logic used on the frontend, kept in sync
// here since the backend is the source of truth for actually gating approval.
function normalizeName(name) {
  return name.trim().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ');
}

function namesMatch(cacName, ninName) {
  const a = normalizeName(cacName);
  const b = normalizeName(ninName);
  if (!a || !b) return false;
  if (a === b) return true;
  const wordsA = a.split(' ').filter(Boolean);
  const wordsB = b.split(' ').filter(Boolean);
  const overlap = wordsA.filter((w) => wordsB.includes(w));
  const minLen = Math.min(wordsA.length, wordsB.length);
  return minLen > 0 && overlap.length >= minLen;
}

// POST /api/vendor/docs  (multipart/form-data: cacDocument, ninDocument)
const submitVendorDocs = asyncHandler(async (req, res) => {
  const { businessName, cacRegisteredName, ninRegisteredName } = req.body;

  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  if (!vendor) {
    throw AppError.badRequest(
      'This account was not registered as a vendor. Choose Sell Only or Sell & Swap at signup first.',
      'NOT_A_VENDOR_ACCOUNT'
    );
  }
  if (vendor.status === 'APPROVED') {
    throw AppError.badRequest('This vendor is already approved.', 'ALREADY_APPROVED');
  }

  const cacFile = req.files && req.files.cacDocument && req.files.cacDocument[0];
  const ninFile = req.files && req.files.ninDocument && req.files.ninDocument[0];
  if (!cacFile || !ninFile) {
    throw AppError.badRequest('Both CAC registration and National ID documents are required.', 'MISSING_DOCUMENTS');
  }

  const namesVerifiedAutomatically = namesMatch(cacRegisteredName, ninRegisteredName);
  if (!namesVerifiedAutomatically) {
    throw AppError.badRequest(
      "The name on your CAC certificate doesn't match the name on your National ID. Both documents must belong to the same registered owner.",
      'NAME_MISMATCH'
    );
  }

  const [cacUrl, ninUrl] = await Promise.all([
    uploadBuffer(cacFile.buffer, cacFile.originalname, cacFile.mimetype, 'vendor-docs'),
    uploadBuffer(ninFile.buffer, ninFile.originalname, ninFile.mimetype, 'vendor-docs'),
  ]);

  const updated = await prisma.vendorProfile.update({
    where: { userId: req.user.id },
    data: {
      businessName,
      cacDocumentUrl: cacUrl,
      cacRegisteredName,
      ninDocumentUrl: ninUrl,
      ninRegisteredName,
      namesVerifiedAutomatically,
      status: 'PENDING',
      submittedAt: new Date(),
    },
  });

  res.json({
    success: true,
    data: {
      message: 'Documents submitted for review. You can browse and buy while approval is pending.',
      status: updated.status,
    },
  });
});

// GET /api/vendor/status
const getVendorStatus = asyncHandler(async (req, res) => {
  const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  if (!vendor) return res.json({ success: true, data: { status: 'NONE' } });
  res.json({
    success: true,
    data: {
      status: vendor.status,
      businessName: vendor.businessName,
      rejectionReason: vendor.rejectionReason,
      submittedAt: vendor.submittedAt,
    },
  });
});

// PATCH /api/vendor/profile  (business name, bio, shop address/email — editable any time)
const updateVendorProfile = asyncHandler(async (req, res) => {
  const { businessName, bio, shopAddress, shopEmail } = req.body;
  const updated = await prisma.vendorProfile.update({
    where: { userId: req.user.id },
    data: {
      ...(businessName !== undefined ? { businessName } : {}),
      ...(bio !== undefined ? { bio } : {}),
      ...(shopAddress !== undefined ? { shopAddress } : {}),
      ...(shopEmail !== undefined ? { shopEmail } : {}),
    },
  });
  res.json({ success: true, data: updated });
});

module.exports = { submitVendorDocs, getVendorStatus, updateVendorProfile, namesMatch };
