const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const authController = require('../controllers/authController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const v = require('../utils/validators/authValidators');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });

router.post('/register', authLimiter, validate(v.register), authController.register);
router.post('/verify-otp', otpLimiter, validate(v.verifyOtp), authController.verifyOtp);
router.post('/resend-otp', otpLimiter, validate(v.resendOtp), authController.resendOtp);
router.post('/login', authLimiter, validate(v.login), authController.login);
router.post('/refresh', validate(v.refreshToken), authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', requireAuth, authController.me);

module.exports = router;
