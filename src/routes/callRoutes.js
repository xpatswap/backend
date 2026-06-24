const express = require('express');
const router = express.Router();

const callController = require('../controllers/callController');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const v = require('../utils/validators/messagingValidators');

router.use(requireAuth);

router.post('/', validate(v.initiateCall), callController.initiateCall);
router.patch('/:id/status', validate(v.updateCallStatus), callController.updateCallStatus);
router.get('/history', callController.getCallHistory);

module.exports = router;
