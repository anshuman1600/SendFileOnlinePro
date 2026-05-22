import mongoose from "mongoose";

const ShareSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    link: { type: String, required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    plan: { type: String, default: "free" },
    filename: { type: String, default: "Untitled file" },
    storedFilename: { type: String, required: true },
    storageProvider: { type: String, default: "local" },
    remoteUrl: { type: String, default: null },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },
    downloadEvents: [
      {
        timestamp: { type: Date, default: Date.now },
        ip: { type: String, default: "unknown" },
        userAgent: { type: String, default: "unknown" },
        region: { type: String, default: "global" },
        country: { type: String, default: "unknown" },
        device: { type: String, default: "unknown" },
        browser: { type: String, default: "unknown" }
      }
    ],
    passwordHash: { type: String, default: null },
    encrypted: { type: Boolean, default: false },
    encryptionSalt: { type: String, default: null },
    encryptionIv: { type: String, default: null },
    expiresAfterDownload: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    region: { type: String, default: "global" },
    recipientEmails: { type: [String], default: [] },
    deletedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

export default mongoose.model("Share", ShareSchema);
