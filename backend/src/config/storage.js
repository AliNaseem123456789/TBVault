import "dotenv/config";
import { S3Client } from "@aws-sdk/client-s3";

// MinIO (S3-compatible). Credentials live in .env, never in source.
export const BUCKET = process.env.MINIO_BUCKET || "tbvault";

const storage = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || "http://localhost:9000",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

export default storage;
