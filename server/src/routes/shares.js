import express from "express";
import multer from "multer";
import path from "path";
import bcrypt from "bcryptjs";
import geoip from "geoip-lite";
import UAParser from "ua-parser-js";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { getDownloadUrl, getStorageProvider, removeStoredFile, uploadFile } from "../services/storage.js";
import {
  createShare,
  findShareByCode,
  listShares,
  updateShare,
  deleteShare,
  listDeletedShares
} from "../store/shareStore.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "..", "..", "uploads");

const BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:5173";
const FREE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024;
const PRO_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
const TEAM_LIMIT_BYTES = 100 * 1024 * 1024 * 1024;
const WEEKLY_FREE_LIMIT = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const weeklyUsage = new Map();

const mailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: process.env.SMTP_USER
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    : undefined
});

const upload = multer({ storage: multer.memoryStorage() });

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const generateLink = (code) => `${BASE_URL}/share/${code}`;

const getClientIp = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown";

const readPassword = (req) =>
  req.headers["x-share-password"] || req.query.password || req.body?.password || "";

const removeFile = async (share) => removeStoredFile(share);

const ensureNotExpired = async (share) => {
  if (!share) {
    return null;
  }
  if (share.expiresAt && new Date(share.expiresAt) <= new Date()) {
    await removeFile(share);
    await deleteShare(share.code);
    return null;
  }
  return share;
};

const enforceLimits = (plan, sizeBytes, clientIp) => {
  const normalizedPlan = plan || "free";
  const limit = normalizedPlan === "teams" ? TEAM_LIMIT_BYTES :
    normalizedPlan === "pro" ? PRO_LIMIT_BYTES : FREE_LIMIT_BYTES;

  if (sizeBytes > limit) {
    return { ok: false, message: `File exceeds ${normalizedPlan} plan limit.` };
  }

  if (normalizedPlan !== "free") {
    return { ok: true };
  }

  const usage = weeklyUsage.get(clientIp) || { count: 0, weekStart: Date.now() };
  if (Date.now() - usage.weekStart > WEEK_MS) {
    usage.count = 0;
    usage.weekStart = Date.now();
  }
  if (usage.count >= WEEKLY_FREE_LIMIT) {
    return { ok: false, message: "Free plan weekly share limit reached." };
  }
  usage.count += 1;
  weeklyUsage.set(clientIp, usage);
  return { ok: true };
};

const ensureOwner = (share, userId) => {
  if (!share || !userId) {
    return false;
  }
  return share.ownerId?.toString() === userId;
};

router.post("/", optionalAuth, upload.single("file"), async (req, res) => {
  const {
    expiresInDays = 7,
    expiresAfterDownload = "false",
    plan = "free",
    password = "",
    region = "global",
    recipientEmails = "",
    encrypted = "false",
    encryptionSalt = "",
    encryptionIv = ""
  } = req.body || {};
  const file = req.file;

  if (!file) {
    return res.status(400).json({ message: "File is required" });
  }

  const clientIp = getClientIp(req);
  const effectivePlan = req.user?.plan || plan;
  const limitCheck = enforceLimits(effectivePlan, file.size, clientIp);
  if (!limitCheck.ok) {
    await removeFile({ storedFilename: file.originalname, storageProvider: "local" });
    return res.status(400).json({ message: limitCheck.message });
  }

  const code = generateCode();
  const link = generateLink(code);
  const maxDays = effectivePlan === "free" ? 7 : 30;
  const requestedDays = Math.min(Number(expiresInDays) || 7, maxDays);
  const expiresAt = new Date(Date.now() + requestedDays * 24 * 60 * 60 * 1000);
  const expiresOnDownload = String(expiresAfterDownload) === "true";
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const encryptedFlag = String(encrypted) === "true";
  const emails = recipientEmails
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  const stored = await uploadFile({
    buffer: file.buffer,
    filename: file.originalname,
    mimeType: file.mimetype
  });

  const share = await createShare({
    code,
    link,
    ownerId: req.user?.id || null,
    plan: effectivePlan,
    filename: file.originalname,
    storedFilename: stored.storedFilename,
    storageProvider: stored.storageProvider,
    remoteUrl: stored.remoteUrl,
    mimeType: file.mimetype,
    size: file.size,
    downloads: 0,
    downloadEvents: [],
    passwordHash,
    encrypted: encryptedFlag,
    encryptionSalt: encryptionSalt || null,
    encryptionIv: encryptionIv || null,
    expiresAfterDownload: expiresOnDownload,
    expiresAt,
    region,
    recipientEmails: emails,
    createdAt: new Date()
  });

  res.status(201).json({
    message: "Share created",
    share: {
      code: share.code,
      link: share.link,
      downloadUrl: `http://localhost:5000/api/shares/${share.code}/download`,
      plan: share.plan,
      filename: share.filename,
      size: share.size,
      downloads: share.downloads ?? 0,
      expiresAfterDownload: share.expiresAfterDownload,
    expiresAt: share.expiresAt,
      region: share.region,
      recipientEmails: share.recipientEmails,
      passwordRequired: Boolean(share.passwordHash),
      encrypted: share.encrypted,
      encryptionSalt: share.encryptionSalt,
      encryptionIv: share.encryptionIv
    }
  });
});

router.get("/", requireAuth, async (req, res) => {
  const shares = await listShares(req.user.id);
  res.json({
    shares: shares.map((share) => ({
      code: share.code,
      filename: share.filename,
      size: share.size,
      downloads: share.downloads ?? 0,
      expiresAt: share.expiresAt,
      plan: share.plan,
      region: share.region,
      passwordRequired: Boolean(share.passwordHash),
      encrypted: share.encrypted,
      lastDownload: share.downloadEvents?.length
        ? share.downloadEvents[share.downloadEvents.length - 1]
        : null
    }))
  });
});

router.get("/deleted", requireAuth, async (req, res) => {
  const shares = await listDeletedShares(req.user.id);
  res.json({
    shares: shares.map((share) => ({
      code: share.code,
      filename: share.filename,
      size: share.size,
      deletedAt: share.deletedAt,
      plan: share.plan,
      region: share.region
    }))
  });
});

router.get("/:code", optionalAuth, async (req, res) => {
  const { code } = req.params;
  const share = await ensureNotExpired(await findShareByCode(code));

  if (!share) {
    return res.status(404).json({ message: "Share not found" });
  }

  const password = readPassword(req);
  if (share.passwordHash) {
    const ok = await bcrypt.compare(password, share.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: "Password required" });
    }
  }

  return res.json({
    share: {
      ...share,
      passwordHash: undefined,
      storedFilename: undefined
    }
  });
});

router.post("/:code/email", requireAuth, async (req, res) => {
  const { code } = req.params;
  const { emails = "" } = req.body || {};
  const share = await ensureNotExpired(await findShareByCode(code));

  if (!share) {
    return res.status(404).json({ message: "Share not found" });
  }

  if (!ensureOwner(share, req.user.id)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const recipients = emails
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  const updated = await updateShare(code, {
    recipientEmails: Array.from(new Set([...(share.recipientEmails || []), ...recipients]))
  });

  if (process.env.SMTP_HOST && recipients.length) {
    await mailTransport.sendMail({
      from: process.env.MAIL_FROM || "sendfileonline@local",
      to: recipients,
      subject: "Your file is ready to download",
      text: `Download link: ${share.link}\nShare code: ${share.code}`
    });
  }

  return res.json({
    message: "Email share queued (demo mode)",
    recipients: updated?.recipientEmails || share.recipientEmails
  });
});

router.get("/:code/download", async (req, res) => {
  const { code } = req.params;
  const password = readPassword(req);
  const shareData = await ensureNotExpired(await findShareByCode(code));

  if (!shareData) {
    return res.status(404).json({ message: "Share not found" });
  }

  if (shareData.passwordHash) {
    const ok = await bcrypt.compare(password, shareData.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: "Password required" });
    }
  }

  const geo = geoip.lookup(getClientIp(req)) || {};
  const parser = new UAParser(req.headers["user-agent"] || "");
  const analyticsEntry = {
    timestamp: new Date(),
    ip: getClientIp(req),
    userAgent: req.headers["user-agent"] || "unknown",
    region: shareData.region || "global",
    country: geo.country || "unknown",
    device: parser.getDevice().model || parser.getDevice().type || "unknown",
    browser: parser.getBrowser().name || "unknown"
  };

  const share = await updateShare(code, {
    downloads: (shareData.downloads ?? 0) + 1,
    downloadEvents: [...(shareData.downloadEvents || []), analyticsEntry]
  });

  if (!share) {
    return res.status(404).json({ message: "Share not found" });
  }

  const remoteUrl = await getDownloadUrl(share);
  if (remoteUrl) {
    return res.redirect(remoteUrl);
  }

  const filePath = path.join(uploadsDir, share.storedFilename);
  return res.download(filePath, share.filename, async () => {
    if (share.expiresAfterDownload) {
      await removeFile(share);
      await deleteShare(share.code);
    }
  });
});

router.delete("/:code", requireAuth, async (req, res) => {
  const { code } = req.params;
  const existing = await findShareByCode(code);
  if (!existing) {
    return res.status(404).json({ message: "Share not found" });
  }
  if (!ensureOwner(existing, req.user.id)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const share = await deleteShare(code);
  if (!share) {
    return res.status(404).json({ message: "Share not found" });
  }
  await removeFile(share);
  return res.json({ message: "Share deleted" });
});

export default router;
