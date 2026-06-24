const express = require('express');
const router = express.Router();
const Joi = require('joi');

const adminController = require('../controllers/adminController');
const validate = require('../middleware/validate');
const { requireAdmin } = require('../middleware/adminAuth');

const adminLoginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().required(),
});
const rejectSchema = Joi.object({ reason: Joi.string().trim().min(3).max(500).required() });
const reportStatusSchema = Joi.object({ status: Joi.string().valid('OPEN', 'REVIEWED', 'DISMISSED', 'ACTIONED').required() });
const resolveDisputeSchema = Joi.object({ resolution: Joi.string().valid('REFUND_BUYER', 'RELEASE_TO_SELLER').required() });

router.post('/login', validate(adminLoginSchema), adminController.adminLogin);

router.use(requireAdmin);
router.get('/payment-account', adminController.getPaymentAccount);
router.get('/vendors', adminController.listVendorApplications);
router.get('/vendors/:id', adminController.getVendorApplication);
router.post('/vendors/:id/approve', adminController.approveVendor);
router.post('/vendors/:id/reject', validate(rejectSchema), adminController.rejectVendor);

router.get('/reports', adminController.listReports);
router.patch('/reports/:id', validate(reportStatusSchema), adminController.updateReportStatus);

router.get('/devices/stolen', adminController.listStolenDevices);
router.get('/devices/stolen-searches', adminController.listStolenImeiSearches);
router.get('/devices/:id/pings', adminController.getDeviceLocationHistory);

// ---- Payments: deposits, payouts, dispute resolution ----
router.get('/deposits', adminController.listDeposits);
router.post('/deposits/:id/confirm', adminController.confirmDeposit);
router.post('/deposits/:id/reject', validate(rejectSchema), adminController.rejectDeposit);

router.get('/payouts', adminController.listPayouts);
router.post('/payouts/:id/mark-paid', adminController.markPayoutPaid);
router.post('/payouts/:id/fail', validate(rejectSchema), adminController.failPayout);

router.get('/orders', adminController.listOrders);
router.post('/orders/:id/resolve', validate(resolveDisputeSchema), adminController.resolveDispute);

module.exports = router;
