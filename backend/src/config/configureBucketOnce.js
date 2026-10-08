import { PutBucketPolicyCommand } from "@aws-sdk/client-s3";
import storage, { BUCKET } from "./storage.js";

// Run once per bucket: `node src/config/configureBucketOnce.js`
// Lets anyone read objects under products/ so <img> tags can load them.
// On AWS, first turn off "Block public access" for this bucket (S3 console → Permissions),
// or the policy is rejected with AccessDenied.
const policy = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: "*",
      Action: ["s3:GetObject"],
      Resource: [`arn:aws:s3:::${BUCKET}/products/*`],
    },
  ],
};

await storage.send(new PutBucketPolicyCommand({ Bucket: BUCKET, Policy: JSON.stringify(policy) }));

console.log(`${BUCKET}: products/* is now public-read`);
