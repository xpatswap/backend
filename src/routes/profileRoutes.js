const express = require('express');
const router = express.Router();

const profileController = require('../controllers/profileController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

router.get('/me', requireAuth, profileController.getMyProfile);
router.patch('/me', requireAuth, profileController.updateMyProfile);
router.post('/me/avatar', requireAuth, uploadImage.single('avatar'), profileController.uploadAvatar);
router.get('/me/wallet', requireAuth, profileController.getMyWallet);

module.exports = router;
