const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const env = require('../config/env');

let s3Client = null;

function getClient() {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    endpoint: env.s3.endpoint,
    region: env.s3.region,
    credentials: {
      accessKeyId: env.s3.accessKeyId,
      secretAccessKey: env.s3.secretAccessKey,
    },
    forcePathStyle: true, // needed for most non-AWS S3-compatible providers (R2, Spaces, MinIO)
  });
  return s3Client;
}

// folder: "listings" | "vendor-docs" | "avatars" | "voice-notes" | "chat-media"
async function uploadBuffer(buffer, originalName, mimeType, folder = 'misc') {
  const ext = path.extname(originalName || '') || '';
  const key = `${folder}/${uuidv4()}${ext}`;

  if (!env.s3.bucket) {
    // No S3 configured — this should never happen in production (env validation
    // throws earlier), but in local dev without storage configured, fail loudly
    // and clearly rather than silently losing uploaded files.
    throw new Error('File storage is not configured (S3_BUCKET missing in .env)');
  }

  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ACL: 'public-read',
    })
  );

  return `${env.s3.publicBaseUrl}/${key}`;
}

async function deleteByUrl(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith(env.s3.publicBaseUrl)) return;
  const key = fileUrl.replace(`${env.s3.publicBaseUrl}/`, '');
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
}

module.exports = { uploadBuffer, deleteByUrl };
