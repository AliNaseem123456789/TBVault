import { PutBucketPolicyCommand } from "@aws-sdk/client-s3";
import storage from "./storage.js";
const policy = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: "*",
      Action: ["s3:GetObject"],
      Resource: ["arn:aws:s3:::tbvault/*"],
    },
  ],
};

await storage.send(
  new PutBucketPolicyCommand({
    Bucket: "tbvault",
    Policy: JSON.stringify(policy),
  })
);

console.log("tbvault is now public-read");