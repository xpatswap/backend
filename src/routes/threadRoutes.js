const express = require('express');
const router = express.Router();
const multer = require('multer');

const threadController = require('../controllers/threadController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const v = require('../utils/validators/messagingValidators');

const flexibleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.use(requireAuth);

router.get('/', threadController.listMyThreads);
router.get('/support', threadController.getSupportThread);
router.post('/from-listing-chat', validate(v.startListingThread), threadController.startListingThread);
router.post('/from-group-reply', validate(v.startGroupReply), threadController.startGroupReplyThread);

router.get('/:id/messages', threadController.getThreadMessages);
router.post('/:id/messages', validate(v.postMessage), threadController.postThreadMessage);
router.post('/:id/messages/media', flexibleUpload.single('file'), threadController.postThreadMediaMessage);
router.post('/:id/location', validate(v.postLocation), threadController.postThreadLocation);

module.exports = router;
