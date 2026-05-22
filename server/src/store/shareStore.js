import Share from "../models/Share.js";

let useMemoryStore = true;
const memoryStore = new Map();
const deletedStore = [];

export const setUseMemoryStore = (value) => {
  useMemoryStore = value;
};

export const createShare = async (share) => {
  if (useMemoryStore) {
    memoryStore.set(share.code, share);
    return share;
  }
  const created = await Share.create(share);
  return created.toObject();
};

export const listShares = async (ownerId) => {
  if (useMemoryStore) {
    const shares = Array.from(memoryStore.values());
    return ownerId ? shares.filter((share) => share.ownerId === ownerId) : shares;
  }
  const filter = { deletedAt: null };
  if (ownerId) {
    filter.ownerId = ownerId;
  }
  return Share.find(filter).sort({ createdAt: -1 }).lean();
};

export const listDeletedShares = async (ownerId) => {
  if (useMemoryStore) {
    const shares = [...deletedStore].sort((a, b) => b.deletedAt - a.deletedAt);
    return ownerId ? shares.filter((share) => share.ownerId === ownerId) : shares;
  }
  const filter = { deletedAt: { $ne: null } };
  if (ownerId) {
    filter.ownerId = ownerId;
  }
  return Share.find(filter).sort({ deletedAt: -1 }).lean();
};

export const findShareByCode = async (code) => {
  if (useMemoryStore) {
    return memoryStore.get(code) ?? null;
  }
  return Share.findOne({ code, deletedAt: null }).lean();
};

export const updateShare = async (code, updates) => {
  if (useMemoryStore) {
    const share = memoryStore.get(code);
    if (!share) {
      return null;
    }
    const updated = { ...share, ...updates };
    memoryStore.set(code, updated);
    return updated;
  }
  return Share.findOneAndUpdate(
    { code, deletedAt: null },
    updates,
    { new: true }
  ).lean();
};

export const incrementDownloads = async (code) => {
  if (useMemoryStore) {
    const share = memoryStore.get(code);
    if (!share) {
      return null;
    }
    const updated = { ...share, downloads: (share.downloads ?? 0) + 1 };
    memoryStore.set(code, updated);
    return updated;
  }

  return Share.findOneAndUpdate(
    { code },
    { $inc: { downloads: 1 } },
    { new: true }
  ).lean();
};

export const deleteShare = async (code) => {
  if (useMemoryStore) {
    const existing = memoryStore.get(code);
    memoryStore.delete(code);
    if (existing) {
      deletedStore.push({ ...existing, deletedAt: new Date() });
    }
    return existing ?? null;
  }
  const deleted = await Share.findOneAndUpdate(
    { code },
    { deletedAt: new Date() },
    { new: true }
  ).lean();
  return deleted;
};
