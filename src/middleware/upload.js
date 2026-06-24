const multer = require('multer');
const AppError = require('../utils/AppError');

const storage = multer.memoryStorage();

const imageFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) return cb(null, true);
  cb(AppError.badRequest('Only image files are allowed for this upload.', 'INVALID_FILE_TYPE'));
};

const docFileFilter = (req, file, cb) => {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(AppError.badRequest('Only PDF or image files (JPEG/PNG/WEBP) are allowed.', 'INVALID_FILE_TYPE'));
};

const audioFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('audio/')) return cb(null, true);
  cb(AppError.badRequest('Only audio files are allowed for this upload.', 'INVALID_FILE_TYPE'));
};

const uploadImage = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const uploadDoc = multer({
  storage,
  fileFilter: docFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadAudio = multer({
  storage,
  fileFilter: audioFileFilter,
  limits: { fileSize: 15 * 1024 * 1024 }, // voice notes can run a bit longer
});

module.exports = { uploadImage, uploadDoc, uploadAudio };
