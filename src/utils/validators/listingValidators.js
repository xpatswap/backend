const Joi = require('joi');

// multer/multipart quirk: a field appended once (e.g. exactly one repair
// checkbox checked) arrives as a bare string, not a single-element array.
// This coerces it into an array before the array schema below validates it.
const repairDetailsField = Joi.alternatives()
  .try(
    Joi.array().items(Joi.string().trim().max(50)),
    Joi.string().trim().max(50).custom((value) => (value ? [value] : []))
  )
  .default([]);

const CONDITIONS = ['BRAND_NEW', 'UK_USED', 'NIGERIAN_USED', 'REPAIRED', 'REFURBISHED'];

// Minimum guarantee days enforced per condition. Sellers may offer more than
// this, never less. REFURBISHED is always 0 — a non-original device/parts
// carries no guarantee at all, regardless of what the seller requests.
const GUARANTEE_MINIMUMS = {
  BRAND_NEW: 7,
  UK_USED: 7,
  NIGERIAN_USED: 2,
  REPAIRED: 2,
  REFURBISHED: 0,
};

const DEFAULT_GUARANTEE_NOTE = 'Guarantee is void if there is any physical damage to the device.';

const createListing = Joi.object({
  brandId: Joi.string().uuid().required(),
  categoryId: Joi.string().uuid().required(),
  name: Joi.string().trim().min(2).max(150).required(),
  model: Joi.string().trim().min(1).max(150).required(),
  storage: Joi.string().trim().max(50).allow('', null),
  color: Joi.string().trim().max(50).allow('', null),
  condition: Joi.string().valid(...CONDITIONS).required(),
  estimatedValue: Joi.number().integer().min(1).required(),
  wantsInReturn: Joi.string().trim().max(300).allow('', null),
  batteryHealth: Joi.number().integer().min(0).max(100).default(95),
  repairDetails: repairDetailsField,
  repairNotes: Joi.string().trim().max(500).allow('', null),
  // Seller-chosen guarantee length; the .custom() below clamps it up to the
  // per-condition minimum and forces REFURBISHED to exactly 0.
  guaranteeDays: Joi.number().integer().min(0).max(365).default(0),
  guaranteeNote: Joi.string().trim().max(300).allow('', null),
  deviceId: Joi.string().uuid().allow('', null), // optional link to a registered device (IMEI)
}).custom((value, helpers) => {
  // Repair disclosure now applies to REPAIRED (the "worked on" condition),
  // not REFURBISHED (which means a non-original device/parts, not a disclosed repair job).
  if (value.condition === 'REPAIRED') {
    const hasDetails = Array.isArray(value.repairDetails) && value.repairDetails.length > 0;
    const hasNotes = value.repairNotes && value.repairNotes.trim().length > 0;
    if (!hasDetails && !hasNotes) {
      return helpers.error('any.custom', {
        message: 'Repaired listings must specify at least one repair item or a note describing the work done.',
      });
    }
  }

  const minimum = GUARANTEE_MINIMUMS[value.condition] ?? 0;
  if (value.condition === 'REFURBISHED') {
    value.guaranteeDays = 0; // never allow a guarantee on a non-original device
  } else if (value.guaranteeDays < minimum) {
    value.guaranteeDays = minimum; // silently raise to the enforced minimum rather than reject
  }
  if (!value.guaranteeNote) {
    value.guaranteeNote = value.condition === 'REFURBISHED' ? 'No guarantee on refurbished devices.' : DEFAULT_GUARANTEE_NOTE;
  }

  return value;
}, 'Repair disclosure + guarantee minimum enforcement');

const updateListing = createListing.fork(
  ['brandId', 'categoryId', 'name', 'model', 'condition', 'estimatedValue'],
  (schema) => schema.optional()
);

const togglePublish = Joi.object({
  published: Joi.boolean().required(),
});

const listingQuery = Joi.object({
  brand: Joi.string().trim().allow(''),
  category: Joi.string().trim().allow(''),
  condition: Joi.string().valid(...CONDITIONS).allow(''),
  q: Joi.string().trim().max(100).allow(''),
  sellerId: Joi.string().uuid().allow(''),
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = { createListing, updateListing, togglePublish, listingQuery, GUARANTEE_MINIMUMS, CONDITIONS };
