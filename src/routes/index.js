const express = require('express');
const router = express.Router();

router.use('/auth', require('./authRoutes'));
router.use('/vendor', require('./vendorRoutes'));
router.use('/listings', require('./listingRoutes'));
router.use('/communities', require('./communityRoutes'));
router.use('/threads', require('./threadRoutes'));
router.use('/calls', require('./callRoutes'));
router.use('/profile', require('./profileRoutes'));
router.use('/sellers', require('./sellerRoutes'));
router.use('/notifications', require('./notificationRoutes'));
router.use('/reports', require('./reportRoutes'));
router.use('/devices', require('./deviceRoutes'));
router.use('/wallet', require('./walletRoutes'));
router.use('/orders', require('./orderRoutes'));
router.use('/admin', require('./adminRoutes'));

router.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }));

module.exports = router;
