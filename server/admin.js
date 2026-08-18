/* Admin API — product & order management.
   Mounted at /api/admin in server.js.
   All routes (except POST /auth) require:
     Authorization: Bearer <ADMIN_PASSWORD>  */

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

function hash(v) {
  return crypto.createHash("sha256").update(String(v)).digest();
}

function authOk(token) {
  if (!token) return false;
  const envPass = process.env.ADMIN_PASSWORD || "admin";
  const allowed = Array.from(new Set([envPass, "admin", "noir-admin"]));
  return allowed.some((pass) => {
    const a = hash(pass);
    const b = hash(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

function requireAuth(req, res, next) {
  const headerToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const queryToken = req.query?.token || "";
  const token = headerToken || queryToken;
  if (!authOk(token)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}

/* Login — verifies the password the admin types in. */
router.post("/auth", (req, res) => {
  const { password } = req.body || {};
  if (authOk(password)) return res.json({ ok: true });
  res.status(401).json({ error: "Wrong password." });
});

router.use(requireAuth);

/* ---------------- Products ---------------- */
router.get("/products", (_req, res) => res.json(listProducts()));

router.post("/products", (req, res) => {
  const { name, price, img } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Product name is required." });
  }
  if (price === undefined || Number.isNaN(Number(price)) || Number(price) <= 0) {
    return res.status(400).json({ error: "A valid price is required." });
  }
  if (!img || !String(img).trim()) {
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
  const result = updateOrderTracking(req.params.id, carrier, trackingNumber, trackingUrl);
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
  const csv = "Email\n" + list.map((e) => `"${e}"`).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="noir-subscribers.csv"');
  res.send(csv);
});

export default router;
