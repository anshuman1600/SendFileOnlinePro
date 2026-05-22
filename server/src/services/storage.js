import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v2 as cloudinary } from "cloudinary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "..", "..", "uploads");

const provider = process.env.STORAGE_PROVIDER || "local";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    : undefined
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export const getStorageProvider = () => provider;

export const uploadFile = async ({ buffer, filename, mimeType }) => {
  if (provider === "s3") {
    const key = `${Date.now()}-${filename}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType
      })
    );
    return { storedFilename: key, remoteUrl: null, storageProvider: "s3" };
  }

  if (provider === "cloudinary") {
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: "raw", public_id: `${Date.now()}-${filename}` },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(buffer);
    });
    return { storedFilename: uploadResult.public_id, remoteUrl: uploadResult.secure_url, storageProvider: "cloudinary" };
  }

  const storedFilename = `${Date.now()}-${filename}`;
  const filePath = path.join(uploadsDir, storedFilename);
  fs.writeFileSync(filePath, buffer);
  return { storedFilename, remoteUrl: null, storageProvider: "local" };
};

export const getDownloadUrl = async (share) => {
  if (share.storageProvider === "s3") {
    const command = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: share.storedFilename });
    return getSignedUrl(s3Client, command, { expiresIn: 300 });
  }
  if (share.storageProvider === "cloudinary") {
    return share.remoteUrl;
  }
  return null;
};

export const removeStoredFile = async (share) => {
  if (share.storageProvider === "s3") {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: share.storedFilename })
    );
    return;
  }
  if (share.storageProvider === "cloudinary") {
    await cloudinary.uploader.destroy(share.storedFilename, { resource_type: "raw" });
    return;
  }
  if (share.storedFilename) {
    const filePath = path.join(uploadsDir, share.storedFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
};