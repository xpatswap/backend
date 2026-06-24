const express = require('express');
const router = express.Router();

const vendorController = require('../controllers/vendorController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { uploadDoc } = require('../middleware/upload');
const v = require('../utils/validators/authValidators');

router.use(requireAuth);

router.post(
  '/docs',
  uploadDoc.fields([{ name: 'cacDocument', maxCount: 1 }, { name: 'ninDocument', maxCount: 1 }]),
  validate(v.vendorDocs),
  vendorController.submitVendorDocs
);
router.get('/status', vendorController.getVendorStatus);
router.patch('/profile', vendorController.updateVendorProfile);

module.exports = router;
