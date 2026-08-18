/* Admin API — product & order management.
   Mounted at /api/admin in server.js.
   All routes (except POST /auth) require:
     Authorization: Bearer <SESSION_TOKEN>  */

import express from "express";
import crypto from "node:crypto";
import {
  listProducts,
  getProduct,
  addProduct,
  updateProduct,
  deleteProduct,
} from "./products-store.js";
import {
  listOrders,
  updateOrderStatus,
  updateOrderTracking,
  listNewsletter,
  listCoupons,
  addCoupon,
  deleteCoupon,
} from "./db.js";

const router = express.Router();

/* In-memory session store: token -> { createdAt, expiresAt, ip } */
const SESSIONS = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/* In-memory login rate limiter: ip -> { count, lockedUntil, firstAttempt } */
const LOGIN_ATTEMPTS = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

// Periodic cleanup of expired sessions and attempts
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of SESSIONS.entries()) {
    if (now > session.expiresAt) SESSIONS.delete(token);
  }
  for (const [ip, data] of LOGIN_ATTEMPTS.entries()) {
    if (now > data.lockedUntil && now - data.firstAttempt > ATTEMPT_WINDOW_MS) {
      LOGIN_ATTEMPTS.delete(ip);
    }
  }
}, 60 * 1000);

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function verifyPassword(inputPassword) {
  if (!inputPassword || typeof inputPassword !== "string") return false;
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured || typeof configured !== "string" || configured.trim().length === 0) {
    return false;
  }
  // Constant-time comparison using fixed-length SHA256 hashes
  const a = crypto.createHash("sha256").update(configured).digest();
  const b = crypto.createHash("sha256").update(inputPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

export function isValidAdminSession(token) {
  if (!token || typeof token !== "string") return false;
  const session = SESSIONS.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    SESSIONS.delete(token);
    return false;
  }
  return true;
}

export function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ") && !authHeader.startsWith("bearer ")) {
    return res.status(401).json({ error: "Unauthorized. Valid Bearer token required." });
  }

  const token = authHeader.slice(7).trim();
  if (!isValidAdminSession(token)) {
    return res.status(401).json({ error: "Unauthorized. Session expired or invalid." });
  }

  req.adminSession = SESSIONS.get(token);
  next();
}

/* ---------------- Auth Endpoints ---------------- */

/* Login — returns a cryptographically secure session token upon success */
router.post("/auth", (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();
  const attempt = LOGIN_ATTEMPTS.get(ip) || { count: 0, lockedUntil: 0, firstAttempt: now };

  if (now < attempt.lockedUntil) {
    const remainingSec = Math.ceil((attempt.lockedUntil - now) / 1000);
    return res.status(429).json({
      error: `Too many failed login attempts. Account temporarily locked for ${remainingSec} seconds.`,
    });
  }

  const { password } = req.body || {};

  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.trim().length === 0) {
    return res.status(503).json({
      error: "Admin authentication is disabled because ADMIN_PASSWORD is not configured on the server.",
    });
  }

  if (!verifyPassword(password)) {
    attempt.count += 1;
    if (now - attempt.firstAttempt > ATTEMPT_WINDOW_MS) {
      attempt.firstAttempt = now;
      attempt.count = 1;
    }
    if (attempt.count >= MAX_FAILED_ATTEMPTS) {
      attempt.lockedUntil = now + LOCKOUT_MS;
      LOGIN_ATTEMPTS.set(ip, attempt);
      return res.status(429).json({
        error: "Too many failed attempts. Login locked for 15 minutes.",
      });
    }
    LOGIN_ATTEMPTS.set(ip, attempt);
    return res.status(401).json({ error: "Invalid credentials." });
  }

  // Reset failed attempts upon successful login
  LOGIN_ATTEMPTS.delete(ip);

  // Generate cryptographically secure 32-byte session token
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = now + SESSION_TTL_MS;

  SESSIONS.set(sessionToken, {
    createdAt: now,
    expiresAt,
    ip,
  });

  return res.json({
    ok: true,
    token: sessionToken,
    expiresAt,
  });
});

/* Logout — explicitly revokes the session token */
router.post("/logout", requireAdminAuth, (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  SESSIONS.delete(token);
  res.json({ ok: true });
});

/* All routes below require valid session */
router.use(requireAdminAuth);

/* ---------------- Products ---------------- */
router.get("/products", (_req, res) => res.json(listProducts()));

router.post("/products", (req, res) => {
  const { name, price, img } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Product name is required." });
  }
  if (price === undefined || Number.isNaN(Number(price)) || Number(price) <= 0) {
    return res.status(400).json({ error: "A valid positive price is required." });
  }
  if (!img || typeof img !== "string" || !img.trim()) {
    return res.status(400).json({ error: "An image URL is required." });
  }
  res.status(201).json(addProduct(req.body));
});

router.put("/products/:id", (req, res) => {
  if (!getProduct(req.params.id)) {
    return res.status(404).json({ error: "Product not found." });
  }
  res.json(updateProduct(req.params.id, req.body));
});

router.delete("/products/:id", (req, res) => {
  if (!deleteProduct(req.params.id)) {
    return res.status(404).json({ error: "Product not found." });
  }
  res.json({ ok: true });
});

/* ---------------- Orders ---------------- */
router.get("/orders", (_req, res) => res.json(listOrders()));

router.patch("/orders/:id", (req, res) => {
  const result = updateOrderStatus(req.params.id, req.body?.status);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.post("/orders/:id/ship", (req, res) => {
  const { carrier, trackingNumber, trackingUrl } = req.body || {};
  const result = updateOrderTracking(
    req.params.id,
    (carrier || "").slice(0, 80),
    (trackingNumber || "").slice(0, 80),
    (trackingUrl || "").slice(0, 200)
  );
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

/* ---------------- Coupons ---------------- */
router.get("/coupons", (_req, res) => res.json(listCoupons()));

router.post("/coupons", (req, res) => {
  const result = addCoupon(req.body || {});
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.delete("/coupons/:code", (req, res) => {
  res.json(deleteCoupon(req.params.code));
});

/* ---------------- Newsletter ---------------- */
router.get("/newsletter", (_req, res) => res.json(listNewsletter()));

router.get("/newsletter/export", (_req, res) => {
  const list = listNewsletter();
  // Safe CSV export: sanitize formula injection chars (=, +, -, @)
  const sanitizeCsvCell = (val) => {
    const s = String(val).replace(/"/g, '""');
    if (/^[=+\-@]/.test(s)) return `"\t${s}"`;
    return `"${s}"`;
  };
  const csv = "Email\n" + list.map((e) => sanitizeCsvCell(e)).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="noir-subscribers.csv"');
  res.send(csv);
});

export default router;
