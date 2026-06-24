const Joi = require('joi');

const postMessage = Joi.object({
  text: Joi.string().trim().max(2000).allow('', null),
  sharedListingId: Joi.string().uuid().allow('', null),
});

const startGroupReply = Joi.object({
  communityMessageId: Joi.string().uuid().required(),
  replyText: Joi.string().trim().min(1).max(2000).required(),
});

const startListingThread = Joi.object({
  listingId: Joi.string().uuid().required(),
});

const postLocation = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  accuracyM: Joi.number().min(0).allow(null),
});

const initiateCall = Joi.object({
  receiverId: Joi.string().uuid().required(),
  type: Joi.string().valid('VOICE', 'VIDEO').required(),
  threadId: Joi.string().uuid().allow(null, ''),
});

const updateCallStatus = Joi.object({
  status: Joi.string().valid('CONNECTED', 'DECLINED', 'MISSED', 'ENDED').required(),
});

const createReport = Joi.object({
  reportedUserId: Joi.string().uuid().allow(null, ''),
  reportedListingId: Joi.string().uuid().allow(null, ''),
  reason: Joi.string().trim().min(3).max(200).required(),
  details: Joi.string().trim().max(1000).allow('', null),
});

module.exports = {
  postMessage,
  startGroupReply,
  startListingThread,
  postLocation,
  initiateCall,
  updateCallStatus,
  createReport,
};
