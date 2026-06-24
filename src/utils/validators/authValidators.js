const Joi = require('joi');

const bankAccountSchema = Joi.object({
  bankName: Joi.string().trim().min(2).max(100).required(),
  accountNumber: Joi.string().trim().pattern(/^\d{10}$/).required().messages({
    'string.pattern.base': 'Account number must be exactly 10 digits.',
  }),
  accountName: Joi.string().trim().min(2).max(150).required(),
});

const register = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().trim().lowercase().email().required(),
  phone: Joi.string().trim().pattern(/^[0-9+\-\s]{7,20}$/).required(),
  dob: Joi.date().iso().max('now').required(),
  address: Joi.string().trim().min(5).max(300).required(),
  password: Joi.string().min(8).max(128).required(),
  accountType: Joi.string().valid('BUYER', 'SELL_ONLY', 'SELL_SWAP').required(),
  referralCode: Joi.string().trim().uppercase().max(20).allow('', null),
  bankAccounts: Joi.array().items(bankAccountSchema).min(1).max(2).required().messages({
    'array.min': 'At least one bank account is required.',
    'array.max': 'You can register a maximum of 2 bank accounts.',
  }),
});

const login = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().required(),
});

const verifyOtp = Joi.object({
  userId: Joi.string().uuid().required(),
  code: Joi.string().length(6).pattern(/^[0-9]+$/).required(),
});

const resendOtp = Joi.object({
  userId: Joi.string().uuid().required(),
});

const refreshToken = Joi.object({
  refreshToken: Joi.string().required(),
});

const vendorDocs = Joi.object({
  businessName: Joi.string().trim().min(2).max(150).required(),
  cacRegisteredName: Joi.string().trim().min(2).max(150).required(),
  ninRegisteredName: Joi.string().trim().min(2).max(150).required(),
});

module.exports = { register, login, verifyOtp, resendOtp, refreshToken, vendorDocs };
