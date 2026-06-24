const express = require('express');
const router = express.Router();
const Joi = require('joi');

const deviceController = require('../controllers/deviceController');
const validate = require('../middleware/validate');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const registerDeviceSchema = Joi.object({
  imei: Joi.string().trim().length(15).pattern(/^[0-9]+$/).required(),
  brand: Joi.string().trim().max(50).allow('', null),
  model: Joi.string().trim().max(100).allow('', null),
});

const checkinSchema = Joi.object({
  imei: Joi.string().trim().length(15).pattern(/^[0-9]+$/).allow('', null),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
  accuracyM: Joi.number().min(0).allow(null),
});

router.get('/check/:imei', optionalAuth, deviceController.checkImei);
router.post('/checkin', optionalAuth, validate(checkinSchema), deviceController.deviceCheckin);
router.get('/:id/ownership-summary', deviceController.getOwnershipSummary);

router.use(requireAuth);
router.post('/', validate(registerDeviceSchema), deviceController.registerDevice);
router.get('/mine', deviceController.listMyDevices);
router.post('/:id/report-stolen', deviceController.reportStolen);
router.post('/:id/mark-recovered', deviceController.markRecovered);
router.get('/:id/pings', deviceController.getDevicePings);
router.get('/:id/ownership-history', deviceController.getOwnershipHistory);

module.exports = router;
