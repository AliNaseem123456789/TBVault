import "dotenv/config";
import { S3Client } from "@aws-sdk/client-s3";

// Product images live in an S3 bucket. Credentials live in .env, never in source.
//   AWS S3:  set S3_REGION and S3_BUCKET, leave S3_ENDPOINT empty.
//   MinIO (or any S3-compatible server): also set S3_ENDPOINT, e.g. http://localhost:9000.
// Without S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY the SDK falls back to its default
// credential chain (an IAM role on EC2/ECS, or ~/.aws/credentials).
export const BUCKET = process.env.S3_BUCKET || "tbvault";

const endpoint = process.env.S3_ENDPOINT;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

const storage = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
});

export default storage;
