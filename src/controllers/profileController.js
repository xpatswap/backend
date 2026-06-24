const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { uploadBuffer } = require('../services/storageService');

// GET /api/profile/me
const getMyProfile = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const vendorProfile = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
  const listingCount = await prisma.listing.count({ where: { sellerId: req.user.id } });

  res.json({
    success: true,
    data: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      address: user.address,
      avatarUrl: user.avatarUrl,
      accountType: user.accountType,
      vendorProfile: vendorProfile
        ? {
            businessName: vendorProfile.businessName,
            bio: vendorProfile.bio,
            shopAddress: vendorProfile.shopAddress,
            shopEmail: vendorProfile.shopEmail,
            status: vendorProfile.status,
          }
        : null,
      listingCount,
    },
  });
});

// PATCH /api/profile/me { fullName?, address? }
const updateMyProfile = asyncHandler(async (req, res) => {
  const { fullName, address } = req.body;
  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { ...(fullName ? { fullName } : {}), ...(address ? { address } : {}) },
  });
  res.json({ success: true, data: { id: updated.id, fullName: updated.fullName, address: updated.address } });
});

// POST /api/profile/me/avatar (multipart: avatar)
const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('No file uploaded.');
  const url = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype, 'avatars');
  await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: url } });
  res.json({ success: true, data: { avatarUrl: url } });
});

// GET /api/sellers/:userId -> public shop page (business info + published products)
const getSellerShop = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
  if (!user) throw AppError.notFound('Seller not found.');

  const vendorProfile = await prisma.vendorProfile.findUnique({ where: { userId: user.id } });

  const listings = await prisma.listing.findMany({
    where: { sellerId: user.id, published: true },
    include: { brand: true, category: true, photos: { orderBy: { sortOrder: 'asc' }, take: 1 } },
    orderBy: { createdAt: 'desc' },
  });

  const stats = await prisma.listing.aggregate({
    where: { sellerId: user.id },
    _sum: { swapsCount: true, likesCount: true },
  });

  res.json({
    success: true,
    data: {
      userId: user.id,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      businessName: vendorProfile ? vendorProfile.businessName : user.fullName,
      bio: vendorProfile ? vendorProfile.bio : null,
      shopAddress: vendorProfile ? vendorProfile.shopAddress : null,
      shopEmail: vendorProfile ? vendorProfile.shopEmail : null,
      isVerifiedVendor: vendorProfile ? vendorProfile.status === 'APPROVED' : false,
      totalSwaps: stats._sum.swapsCount || 0,
      totalLikes: stats._sum.likesCount || 0,
      products: listings.map((l) => ({
        id: l.id,
        name: l.name,
        model: l.model,
        estimatedValue: l.estimatedValue,
        condition: l.condition,
        coverPhotoUrl: (l.photos[0] || {}).url || null,
        brand: l.brand.name,
        category: l.category.name,
      })),
    },
  });
});

// GET /api/profile/me/wallet -> balance + transaction history
const getMyWallet = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const transactions = await prisma.walletTransaction.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({
    success: true,
    data: { balance: user.walletBalance, transactions },
  });
});

module.exports = { getMyProfile, updateMyProfile, uploadAvatar, getSellerShop, getMyWallet };
