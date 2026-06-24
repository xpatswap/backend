const express = require('express');
const router = express.Router();

const notificationController = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', notificationController.listNotifications);
router.patch('/:id/read', notificationController.markRead);
router.patch('/read-all', notificationController.markAllRead);
router.post('/push-subscribe', notificationController.savePushSubscription);
router.post('/push-unsubscribe', notificationController.removePushSubscription);

module.exports = router;
