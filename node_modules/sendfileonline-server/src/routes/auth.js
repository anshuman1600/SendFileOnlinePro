import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const router = express.Router();

const signToken = (user) =>
  jwt.sign(
    { id: user._id.toString(), email: user.email, name: user.name, plan: user.plan },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: "7d" }
  );

router.post("/register", async (req, res) => {
  const { name, email, password, plan = "free" } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ message: "Missing fields" });
  }
  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ message: "User already exists" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, passwordHash, plan });
  const token = signToken(user);
  return res.status(201).json({ token, user: { id: user._id, name, email, plan } });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: "Missing fields" });
  }
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: "Invalid credentials" });
  }
  const token = signToken(user);
  return res.json({ token, user: { id: user._id, name: user.name, email, plan: user.plan } });
});

export default router;