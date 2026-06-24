const express = require('express');
const router = express.Router();

const profileController = require('../controllers/profileController');

router.get('/:userId', profileController.getSellerShop);

module.exports = router;
