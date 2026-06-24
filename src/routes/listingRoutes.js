const express = require('express');
const router = express.Router();

const listingController = require('../controllers/listingController');
const validate = require('../middleware/validate');
const { requireAuth, requireApprovedVendor, optionalAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');
const v = require('../utils/validators/listingValidators');

router.get('/brands', listingController.listBrandCatalog);
router.get('/', optionalAuth, validate(v.listingQuery, 'query'), listingController.getListings);
router.get('/ranking', optionalAuth, listingController.getRanking);
router.get('/:id', optionalAuth, listingController.getListingById);
router.get('/:id/seller-other-products', listingController.getOtherProductsFromSeller);

router.post(
  '/',
  requireAuth,
  requireApprovedVendor,
  uploadImage.array('photos', 6),
  validate(v.createListing),
  listingController.createListing
);
router.patch('/:id', requireAuth, validate(v.updateListing), listingController.updateListing);
router.patch('/:id/publish', requireAuth, validate(v.togglePublish), listingController.togglePublish);
router.delete('/:id', requireAuth, listingController.deleteListing);

router.post('/:id/like', requireAuth, listingController.toggleLike);

module.exports = router;
