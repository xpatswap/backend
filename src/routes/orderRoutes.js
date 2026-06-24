const express = require('express');
const router = express.Router();
const Joi = require('joi');

const orderController = require('../controllers/orderController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const createOrderSchema = Joi.object({ listingId: Joi.string().uuid().required() });
const disputeSchema = Joi.object({ reason: Joi.string().trim().min(5).max(500).required() });
const releaseSchema = Joi.object({ code: Joi.string().trim().length(6).pattern(/^[0-9]+$/).required() });

router.use(requireAuth);

router.post('/', validate(createOrderSchema), orderController.createOrder);
router.get('/mine', orderController.listMyOrders);
router.get('/:id', orderController.getOrder);
router.post('/:id/pay', orderController.payForOrder);
router.get('/:id/handoff-code', orderController.getHandoffCode);
router.post('/:id/release', validate(releaseSchema), orderController.releaseWithHandoffCode);
router.post('/:id/dispute', validate(disputeSchema), orderController.disputeOrder);
router.post('/:id/cancel', orderController.cancelOrder);

module.exports = router;
