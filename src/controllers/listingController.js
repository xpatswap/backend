const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { uploadBuffer } = require('../services/storageService');

// Mirrors the frontend's fairness algorithm exactly so the API and UI never disagree.
function computeFairness(myValue, theirValue) {
  const diff = Math.abs(myValue - theirValue);
  const pct = diff / Math.max(myValue, theirValue);
  if (pct <= 0.04) return { label: 'Fair match', tip: 0, diff };
  if (myValue > theirValue) return { label: `You'd add ~$${diff}`, tip: -1, diff };
  return { label: `They'd add ~$${diff}`, tip: 1, diff };
}

function rankingScore(listing) {
  return listing.likesCount * 1.5 + listing.swapsCount * 2;
}

const listingInclude = {
  brand: true,
  category: true,
  photos: { orderBy: { sortOrder: 'asc' } },
  seller: { select: { id: true, fullName: true, avatarUrl: true, accountType: true } },
  device: { select: { id: true, imei: true, status: true } },
};

function serializeListing(listing, viewerLikedIds = new Set()) {
  return {
    id: listing.id,
    name: listing.name,
    model: listing.model,
    storage: listing.storage,
    color: listing.color,
    condition: listing.condition,
    estimatedValue: listing.estimatedValue,
    wantsInReturn: listing.wantsInReturn,
    batteryHealth: listing.batteryHealth,
    repairDetails: listing.repairDetails,
    repairNotes: listing.repairNotes,
    guaranteeDays: listing.guaranteeDays,
    guaranteeNote: listing.guaranteeNote,
    swapsCount: listing.swapsCount,
    likesCount: listing.likesCount,
    likedByMe: viewerLikedIds.has(listing.id),
    published: listing.published,
    createdAt: listing.createdAt,
    brand: { id: listing.brand.id, name: listing.brand.name },
    category: { id: listing.category.id, name: listing.category.name },
    photos: listing.photos.map((p) => ({ url: p.url, isCover: p.isCover })),
    coverPhotoUrl: (listing.photos.find((p) => p.isCover) || listing.photos[0] || {}).url || null,
    seller: listing.seller,
    // Buyer-facing trust signal: this listing is tied to a specific
    // registered, non-stolen device — its IMEI can be checked directly.
    imeiVerified: !!(listing.device && listing.device.status !== 'STOLEN'),
    deviceId: listing.deviceId || null,
    // SELL_ONLY vendors are cash-purchase only — the frontend hides "Propose
    // swap" and shows only "Buy now" for their listings. SELL_SWAP vendors
    // (and BUYER-type sellers, who shouldn't have listings at all but are
    // handled gracefully here) accept both.
    acceptsSwaps: listing.seller.accountType !== 'SELL_ONLY',
  };
}

// GET /api/brands  -> full brand + category folder tree (for "Brand New" folder browsing)
const listBrandCatalog = asyncHandler(async (req, res) => {
  const brands = await prisma.brand.findMany({
    include: { categories: true },
    orderBy: { sortOrder: 'asc' },
  });

  const counts = await prisma.listing.groupBy({
    by: ['brandId', 'categoryId'],
    where: { condition: 'BRAND_NEW', published: true },
    _count: true,
  });

  const data = brands.map((b) => ({
    id: b.id,
    name: b.name,
    colorHex: b.colorHex,
    itemCount: counts.filter((c) => c.brandId === b.id).reduce((sum, c) => sum + c._count, 0),
    categories: b.categories.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      itemCount: (counts.find((x) => x.brandId === b.id && x.categoryId === c.id) || {})._count || 0,
    })),
  }));

  res.json({ success: true, data });
});

// GET /api/listings  (supports brand/category/condition/search/pagination filters)
const getListings = asyncHandler(async (req, res) => {
  const { brand, category, condition, q, sellerId, page, pageSize } = req.query;

  const where = { published: true };
  if (brand) where.brand = { name: brand };
  if (category) where.category = { name: category };
  if (condition) where.condition = condition;
  if (sellerId) where.sellerId = sellerId;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { model: { contains: q, mode: 'insensitive' } },
      { color: { contains: q, mode: 'insensitive' } },
      { seller: { fullName: { contains: q, mode: 'insensitive' } } },
      { seller: { vendorProfile: { businessName: { contains: q, mode: 'insensitive' } } } },
    ];
  }

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: listingInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.listing.count({ where }),
  ]);

  let likedIds = new Set();
  if (req.user && listings.length) {
    // Scoped to just the listing IDs on THIS page, not the user's entire like
    // history platform-wide — fetching every like a user has ever made just
    // to render one page of 20 listings doesn't scale past a handful of users.
    const likes = await prisma.like.findMany({
      where: { userId: req.user.id, listingId: { in: listings.map((l) => l.id) } },
      select: { listingId: true },
    });
    likedIds = new Set(likes.map((l) => l.listingId));
  }

  res.json({
    success: true,
    data: listings.map((l) => serializeListing(l, likedIds)),
    meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  });
});

// GET /api/listings/ranking -> sellers ranked by combined likes + swaps score
// GET /api/listings/ranking -> top sellers ranked by combined likes + swaps score
// IMPORTANT: capped to a fixed leaderboard size and sorted by the database,
// not loaded into application memory and sorted in JS. Loading every
// published listing on the entire platform to compute one ranking page does
// not scale — this used to do exactly that.
const RANKING_LEADERBOARD_SIZE = 100;
const getRanking = asyncHandler(async (req, res) => {
  // True combined-score ranking (likes*1.5 + swaps*2) isn't directly
  // expressible as a single Prisma orderBy, so this approximates it well by
  // pulling a generously-sized candidate set ordered by likes (the larger
  // weight signal) capped at a fixed size, then doing the final precise sort
  // and trim entirely in memory on that small, bounded set — never on the
  // full table.
  const candidates = await prisma.listing.findMany({
    where: { published: true },
    include: listingInclude,
    orderBy: [{ likesCount: 'desc' }, { swapsCount: 'desc' }],
    take: RANKING_LEADERBOARD_SIZE * 3, // wide enough candidate pool that a high-swap/low-like listing still gets fairly considered
  });
  const ranked = candidates
    .map((l) => ({ ...serializeListing(l), score: rankingScore(l) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, RANKING_LEADERBOARD_SIZE);
  res.json({ success: true, data: ranked });
});

// GET /api/listings/:id
const getListingById = asyncHandler(async (req, res) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id }, include: listingInclude });
  if (!listing) throw AppError.notFound('Listing not found.');

  let likedIds = new Set();
  if (req.user) {
    const likes = await prisma.like.findMany({ where: { userId: req.user.id, listingId: listing.id } });
    likedIds = new Set(likes.map((l) => l.listingId));
  }

  const myValue = Number(req.query.myValue) || null;
  const fairness = myValue ? computeFairness(myValue, listing.estimatedValue) : null;

  res.json({ success: true, data: { ...serializeListing(listing, likedIds), fairness } });
});

// GET /api/listings/:id/seller-other-products
const getOtherProductsFromSeller = asyncHandler(async (req, res) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) throw AppError.notFound('Listing not found.');

  const others = await prisma.listing.findMany({
    where: { sellerId: listing.sellerId, published: true, id: { not: listing.id } },
    include: listingInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: others.map((l) => serializeListing(l)) });
});

// POST /api/listings  (multipart/form-data: photos[], + body fields)
// Requires requireAuth + requireApprovedVendor middleware upstream.
const createListing = asyncHandler(async (req, res) => {
  const {
    brandId, categoryId, name, model, storage, color, condition,
    estimatedValue, wantsInReturn, batteryHealth, repairDetails, repairNotes,
    guaranteeDays, guaranteeNote, deviceId,
  } = req.body;

  const files = req.files || [];
  if (files.length === 0) throw AppError.badRequest('Please add at least one photo of the product.', 'PHOTOS_REQUIRED');
  if (files.length > 6) throw AppError.badRequest('A maximum of 6 photos is allowed.', 'TOO_MANY_PHOTOS');

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category || category.brandId !== brandId) {
    throw AppError.badRequest('Selected category does not belong to the selected brand.', 'BRAND_CATEGORY_MISMATCH');
  }

  // Optional: link this listing to a specific registered device (IMEI). Only
  // allowed if the seller actually owns that device and it isn't already
  // tied to another active listing — enforced here rather than relying on
  // the DB's @unique alone, so we can give a clear error instead of a raw
  // constraint violation.
  if (deviceId) {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw AppError.notFound('Selected device not found.', 'DEVICE_NOT_FOUND');
    if (device.ownerId !== req.user.id) throw AppError.forbidden('You can only link a device you own.', 'NOT_DEVICE_OWNER');
    if (device.status === 'STOLEN') throw AppError.badRequest('This device is reported stolen and cannot be listed.', 'DEVICE_STOLEN');
    const alreadyLinked = await prisma.listing.findUnique({ where: { deviceId } });
    if (alreadyLinked) throw AppError.conflict('This device is already linked to another active listing.', 'DEVICE_ALREADY_LISTED');
  }

  const uploadedUrls = await Promise.all(
    files.map((f) => uploadBuffer(f.buffer, f.originalname, f.mimetype, 'listings'))
  );

  const listing = await prisma.listing.create({
    data: {
      sellerId: req.user.id,
      brandId,
      categoryId,
      name,
      model,
      storage: storage || null,
      color: color || null,
      condition,
      estimatedValue,
      wantsInReturn: wantsInReturn || null,
      batteryHealth: batteryHealth || 95,
      repairDetails: Array.isArray(repairDetails) ? repairDetails : (repairDetails ? [repairDetails] : []),
      repairNotes: repairNotes || null,
      guaranteeDays: guaranteeDays || 0,
      guaranteeNote: guaranteeNote || null,
      deviceId: deviceId || null,
      published: true,
      photos: {
        create: uploadedUrls.map((url, i) => ({ url, isCover: i === 0, sortOrder: i })),
      },
    },
    include: listingInclude,
  });

  res.status(201).json({ success: true, data: serializeListing(listing) });
});

// PATCH /api/listings/:id  (owner only)
const updateListing = asyncHandler(async (req, res) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) throw AppError.notFound('Listing not found.');
  if (listing.sellerId !== req.user.id) throw AppError.forbidden('You can only edit your own listings.');

  const updated = await prisma.listing.update({
    where: { id: req.params.id },
    data: req.body,
    include: listingInclude,
  });
  res.json({ success: true, data: serializeListing(updated) });
});

// PATCH /api/listings/:id/publish  { published: true|false }  (owner only)
const togglePublish = asyncHandler(async (req, res) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) throw AppError.notFound('Listing not found.');
  if (listing.sellerId !== req.user.id) throw AppError.forbidden('You can only manage your own listings.');

  const updated = await prisma.listing.update({
    where: { id: req.params.id },
    data: { published: req.body.published },
    include: listingInclude,
  });
  res.json({ success: true, data: serializeListing(updated) });
});

// DELETE /api/listings/:id  (owner only)
const deleteListing = asyncHandler(async (req, res) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.params.id } });
  if (!listing) throw AppError.notFound('Listing not found.');
  if (listing.sellerId !== req.user.id) throw AppError.forbidden('You can only delete your own listings.');

  await prisma.listing.delete({ where: { id: req.params.id } });
  res.json({ success: true, data: { message: 'Listing deleted.' } });
});

// POST /api/listings/:id/like  (toggle)
const toggleLike = asyncHandler(async (req, res) => {
  const listingId = req.params.id;
  const existing = await prisma.like.findUnique({
    where: { userId_listingId: { userId: req.user.id, listingId } },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.like.delete({ where: { id: existing.id } }),
      prisma.listing.update({ where: { id: listingId }, data: { likesCount: { decrement: 1 } } }),
    ]);
    return res.json({ success: true, data: { liked: false } });
  }

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw AppError.notFound('Listing not found.');

  await prisma.$transaction([
    prisma.like.create({ data: { userId: req.user.id, listingId } }),
    prisma.listing.update({ where: { id: listingId }, data: { likesCount: { increment: 1 } } }),
  ]);

  if (listing.sellerId !== req.user.id) {
    await prisma.notification.create({
      data: {
        userId: listing.sellerId,
        type: 'LISTING_LIKED',
        title: 'Someone liked your listing',
        body: listing.name,
        data: { listingId },
      },
    });
  }

  res.json({ success: true, data: { liked: true } });
});

module.exports = {
  listBrandCatalog,
  getListings,
  getRanking,
  getListingById,
  getOtherProductsFromSeller,
  createListing,
  updateListing,
  togglePublish,
  deleteListing,
  toggleLike,
  computeFairness,
};
