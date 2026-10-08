import "dotenv/config";
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import storage, { BUCKET } from "../src/config/storage.js";

/**
 * One-off: copies every product image from the old MinIO bucket into the S3 bucket
 * the app is configured for (S3_* in .env). Keys stay the same, so product_images rows
 * in the database keep working. Safe to re-run: objects already in S3 are skipped.
 *
 *   MINIO_ENDPOINT=http://localhost:9000 MINIO_BUCKET=tbvault MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=...
 *   node scripts/copy-images-to-s3.js
 */
const sourceBucket = process.env.MINIO_BUCKET || "tbvault";
const source = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || "http://localhost:9000",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.MINIO_ACCESS_KEY, secretAccessKey: process.env.MINIO_SECRET_KEY },
});

const existsInTarget = async (key) => {
  try {
    await storage.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
};

let copied = 0;
let skipped = 0;
let token;
do {
  const page = await source.send(new ListObjectsV2Command({ Bucket: sourceBucket, ContinuationToken: token }));
  for (const { Key } of page.Contents ?? []) {
    if (await existsInTarget(Key)) {
      skipped++;
      continue;
    }
    const object = await source.send(new GetObjectCommand({ Bucket: sourceBucket, Key }));
    await storage.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key,
        Body: await object.Body.transformToByteArray(),
        ContentType: object.ContentType,
      })
    );
    copied++;
    console.log(`copied ${Key}`);
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

console.log(`Done: ${copied} copied, ${skipped} already in ${BUCKET}`);
