/* JSON-file database for orders, coupons, reviews, and newsletter subscribers. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "db.json");

const DEFAULT_COUPONS = [
  { code: "NOIR10", type: "percent", value: 10, minSpend: 0, desc: "10% off your entire order" },
  { code: "STUDIO20", type: "percent", value: 20, minSpend: 8000, desc: "20% off orders over ₹8,000" },
  { code: "FREESHIP", type: "shipping", value: 100, minSpend: 0, desc: "Free express shipping" },
];

const EMPTY = { orders: [], seq: 1000, newsletter: [], coupons: DEFAULT_COUPONS, reviews: [] };

let db = { ...EMPTY };

function load() {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
      db = { ...EMPTY };
    }
  }
  db.orders = db.orders || [];
  db.seq = db.seq || 1000;
  db.newsletter = db.newsletter || [];
  db.coupons = db.coupons || DEFAULT_COUPONS;
  db.reviews = db.reviews || [];
}

function persist() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

load();

export function nextOrderId() {
  db.seq += 1;
  persist();
  return `NOIR-${db.seq.toString().padStart(4, "0")}`;
}

export function saveOrder(order) {
  const existingIdx = db.orders.findIndex((o) => o.id === order.id);
  if (existingIdx >= 0) {
    db.orders[existingIdx] = { ...db.orders[existingIdx], ...order };
  } else {
    db.orders.push(order);
  }
  persist();
  return order;
}

export function getOrder(id) {
  if (!id) return null;
  const cleanId = id.toString().trim().toUpperCase();
  return db.orders.find((o) => o.id.toUpperCase() === cleanId) || null;
}

export function getOrderBySession(sessionId) {
  if (!sessionId) return null;
  return db.orders.find((o) => o.stripeSessionId === sessionId || o.razorpayOrderId === sessionId) || null;
}

export function getOrderByEmailAndId(id, email) {
  if (!id || !email) return null;
  const cleanId = id.toString().trim().toUpperCase();
  const cleanEmail = email.toString().trim().toLowerCase();
  return db.orders.find((o) => o.id.toUpperCase() === cleanId && o.email.toLowerCase() === cleanEmail) || null;
}

export function markPaid(orderId, paymentRef) {
  const order = getOrder(orderId);
  if (order) {
    order.status = "paid";
    if (paymentRef) order.paymentRef = paymentRef;
    order.paidAt = new Date().toISOString();
    persist();
  }
  return order;
}

const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled", "refunded"];

export function listOrders() {
  return [...db.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function updateOrderStatus(orderId, status) {
  if (!ORDER_STATUSES.includes(status)) return { error: "Invalid status." };
  const order = getOrder(orderId);
  if (!order) return { error: "Order not found." };
  order.status = status;
  if (status === "paid" && !order.paidAt) order.paidAt = new Date().toISOString();
  persist();
  return order;
}

export function updateOrderTracking(orderId, carrier, trackingNumber, trackingUrl) {
  const order = getOrder(orderId);
  if (!order) return { error: "Order not found." };
  order.carrier = carrier || "BlueDart Express";
  order.trackingNumber = trackingNumber || "";
  order.trackingUrl = trackingUrl || `https://www.bluedart.com/tracking`;
  if (order.status === "paid" || order.status === "pending") {
    order.status = "shipped";
  }
  order.shippedAt = new Date().toISOString();
  persist();
  return order;
}

/* ---------------- Coupons ---------------- */
export function listCoupons() {
  return db.coupons || DEFAULT_COUPONS;
}

export function validateCoupon(code, subtotal = 0) {
  if (!code) return { valid: false, error: "No coupon code provided." };
  const cleanCode = code.toString().trim().toUpperCase();
  const coupon = (db.coupons || DEFAULT_COUPONS).find((c) => c.code.toUpperCase() === cleanCode);
  if (!coupon) return { valid: false, error: "Invalid coupon code." };
  if (coupon.minSpend && subtotal < coupon.minSpend) {
    return { valid: false, error: `Minimum order amount of ₹${coupon.minSpend.toLocaleString("en-IN")} required for code ${coupon.code}.` };
  }

  let discount = 0;
  if (coupon.type === "percent") {
    discount = Math.round((subtotal * coupon.value) / 100);
  } else if (coupon.type === "fixed") {
    discount = Math.min(subtotal, coupon.value);
  } else if (coupon.type === "shipping") {
    discount = 0; // handled during shipping calculation
  }

  return { valid: true, coupon, discount };
}

export function addCoupon(couponData) {
  const code = (couponData.code || "").trim().toUpperCase();
  if (!code) return { error: "Coupon code is required." };
  db.coupons = db.coupons || DEFAULT_COUPONS;
  const existing = db.coupons.find((c) => c.code === code);
  if (existing) return { error: "Coupon code already exists." };
  const coupon = {
    code,
    type: couponData.type || "percent",
    value: Number(couponData.value) || 10,
    minSpend: Number(couponData.minSpend) || 0,
    desc: couponData.desc || `${couponData.value}% discount`,
  };
  db.coupons.push(coupon);
  persist();
  return { ok: true, coupon };
}

export function deleteCoupon(code) {
  db.coupons = (db.coupons || []).filter((c) => c.code.toUpperCase() !== code.toUpperCase());
  persist();
  return { ok: true };
}

/* ---------------- Reviews ---------------- */
export function getProductReviews(productId) {
  const pId = Number(productId);
  return (db.reviews || []).filter((r) => r.productId === pId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function addProductReview(productId, reviewData) {
  const pId = Number(productId);
  const rating = Math.max(1, Math.min(5, Number(reviewData.rating) || 5));
  const review = {
    id: Date.now(),
    productId: pId,
    name: (reviewData.name || "Verified Atelier Guest").trim(),
    rating,
    comment: (reviewData.comment || "").trim(),
    createdAt: new Date().toISOString(),
    verified: true,
  };
  db.reviews = db.reviews || [];
  db.reviews.push(review);
  persist();
  return review;
}

/* ---------------- Newsletter ---------------- */
export function addNewsletter(email) {
  if (db.newsletter.includes(email)) return { already: true };
  db.newsletter.push(email);
  persist();
  return { already: false };
}

export function listNewsletter() {
  return [...db.newsletter];
}

