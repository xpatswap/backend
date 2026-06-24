const express = require('express');
const router = express.Router();

const communityController = require('../controllers/communityController');
const validate = require('../middleware/validate');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const multer = require('multer');
const v = require('../utils/validators/messagingValidators');

// Group chat media can be either an image or a voice note, so accept any single
// file under field name "file" here and validate the mimetype in the controller.
const flexibleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.get('/', optionalAuth, communityController.listCommunities);
router.post('/:id/join', requireAuth, communityController.joinCommunity);
router.get('/:id/messages', requireAuth, communityController.getCommunityMessages);
router.post('/:id/messages', requireAuth, validate(v.postMessage), communityController.postCommunityMessage);
router.post('/:id/messages/media', requireAuth, flexibleUpload.single('file'), communityController.postCommunityMediaMessage);

module.exports = router;
