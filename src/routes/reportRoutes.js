const express = require('express');
const router = express.Router();

const reportController = require('../controllers/reportController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const v = require('../utils/validators/messagingValidators');

router.post('/', requireAuth, validate(v.createReport), reportController.createReport);

module.exports = router;
