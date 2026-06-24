const express = require('express');
const router = express.Router();
const Joi = require('joi');

const walletController = require('../controllers/walletController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const depositSchema = Joi.object({ amount: Joi.number().integer().min(100).required() });
const payoutSchema = Joi.object({
  amount: Joi.number().integer().min(500).required(),
  bankAccountId: Joi.string().trim().required(), // must be a registered bank account ID
});

router.use(requireAuth);

router.get('/', walletController.getMyWalletBalance);
router.get('/transactions', walletController.getMyWalletTransactions);
router.post('/deposits', validate(depositSchema), walletController.requestDeposit);
router.get('/deposits', walletController.getMyDeposits);
router.post('/payouts', validate(payoutSchema), walletController.requestPayout);
router.get('/payouts', walletController.getMyPayouts);
router.get('/bank-accounts', walletController.getMyBankAccounts);

module.exports = router;
