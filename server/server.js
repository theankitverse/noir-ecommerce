/* ============================================================
   NOIR — Express backend
   Endpoints:
     GET  /api/config
     GET  /api/products?cat=&sort=&q=
     GET  /api/products/:id
     POST /api/checkout
     POST /api/payment/verify       (Razorpay signature verification)
     GET  /api/order/session/:sid
     GET  /api/order/:id            (Requires order access token or admin auth)
     GET  /api/order/track          (Requires order id + customer email)
     POST /api/newsletter
     POST /api/admin/auth
     ...  /api/admin/*              (product & order management)
     POST /api/webhooks/stripe
     POST /api/webhooks/razorpay
   ============================================================ */

import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import Razorpay from "razorpay";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listProducts,
  getProduct,
} from "./products-store.js";
import {
  nextOrderId,
  generateOrderAccessToken,
  saveOrder,
  getOrder,
  getOrderByToken,
  getOrderBySession,
  getOrderByEmailAndId,
  maskOrderForTracking,
  markPaid,
  addNewsletter,
  validateCoupon,
  getProductReviews,
  addProductReview,
} from "./db.js";
import adminRouter, { isValidAdminSession } from "./admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 4000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CURRENCY = "INR";
const SYMBOL = "₹";
const FREE_SHIPPING = 10200; // in ₹
const SHIPPING_FEE = 680;    // in ₹

/* Initialize Payment Providers Strictly from Environment Variables */
const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
const stripe = stripeKey ? new Stripe(stripeKey) : null;

const rzpKeyId = (process.env.RAZORPAY_KEY_ID || "").trim();
const rzpKeySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();

const razorpay =
  rzpKeyId && rzpKeySecret
    ? new Razorpay({
        key_id: rzpKeyId,
        key_secret: rzpKeySecret,
      })
    : null;

/* Gateway priority: Razorpay > Stripe > demo */
const GATEWAY = razorpay ? "razorpay" : stripe ? "stripe" : "demo";
const DEMO = GATEWAY === "demo";

if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.trim().length === 0) {
  console.warn("  ⚠️  ADMIN_PASSWORD is not set in .env — admin panel access is disabled until configured.");
}

/* ---------------- Production Security Headers ---------------- */
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; frame-src https://api.razorpay.com https://checkout.razorpay.com https://js.stripe.com https://hooks.stripe.com; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://api.stripe.com https://api.qrserver.com;"
  );
  next();
});

/* ---------------- Webhook (must parse raw body BEFORE express.json) ---------------- */
if (stripe && process.env.STRIPE_WEBHOOK_SECRET) {
  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    (req, res) => {
      const sig = req.headers["stripe-signature"];
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        return res.status(400).send(`Webhook error: ${err.message}`);
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const orderId = session.metadata && session.metadata.orderId;
        if (orderId) {
          markPaid(orderId, session.id);
          console.log(`[webhook] order ${orderId} marked paid`);
        }
      }
      res.json({ received: true });
    }
  );
}

/* Strict body size limit */
app.use(express.json({ limit: "100kb" }));

/* Prevent browser and CDN caching of API endpoints */
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

/* ---------------- Rate Limiter Utility ---------------- */
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of hits.entries()) {
      if (now - data.start > windowMs) hits.delete(ip);
    }
  }, Math.min(windowMs, 60000));

  return (req, res, next) => {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "unknown";
    const now = Date.now();
    const entry = hits.get(ip) || { count: 0, start: now };
    if (now - entry.start > windowMs) {
      entry.count = 0;
      entry.start = now;
    }
    entry.count += 1;
    hits.set(ip, entry);
    if (entry.count > max) {
      return res.status(429).json({ error: message || "Too many requests. Please slow down." });
    }
    next();
  };
}

const checkoutLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many checkout requests. Please try again in 15 minutes.",
});

const reviewLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many review submissions. Please try again later.",
});

const newsletterLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many newsletter requests. Please try again later.",
});

/* ---------------- Helpers ---------------- */
function calcShipping(subtotal, couponVal = null) {
  if (
    couponVal?.coupon &&
    (couponVal.coupon.type === "shipping" ||
      couponVal.coupon.type === "freeship" ||
      ["FREESHIP", "ZEROSHIP", "TESTSHIP"].includes(couponVal.coupon.code))
  ) {
    return 0;
  }
  return subtotal >= FREE_SHIPPING ? 0 : SHIPPING_FEE;
}

function publicProduct(p) {
  return {
    id: p.id,
    name: p.name,
    cat: p.cat,
    price: p.price,
    compare: p.compare,
    badge: p.badge,
    rating: p.rating,
    reviews: p.reviews,
    colors: p.colors,
    fabric: p.fabric,
    care: p.care,
    desc: p.desc,
    img: p.img,
    hover: p.hover,
    gallery: p.gallery,
    sizes: p.sizes || { S: 10, M: 15, L: 8, XL: 5 },
    inStock: p.inStock,
  };
}

/* ---------------- Config ---------------- */
app.get("/api/config", (_req, res) => {
  res.json({
    gateway: GATEWAY,
    demo: DEMO,
    currency: CURRENCY,
    symbol: SYMBOL,
    razorpayKeyId: razorpay ? rzpKeyId : null,
    stripePublicKey: !razorpay && stripe ? (process.env.STRIPE_PUBLISHABLE_KEY || null) : null,
    freeShipping: FREE_SHIPPING,
    shippingFee: SHIPPING_FEE,
  });
});

/* ---------------- Products ---------------- */
app.get("/api/products", (req, res) => {
  let list = listProducts().map(publicProduct);

  const { cat, q, sort } = req.query;
  if (cat && typeof cat === "string" && cat !== "all") {
    list = list.filter((p) => p.cat === cat);
  }
  if (q && typeof q === "string") {
    const cleanQ = q.toLowerCase().slice(0, 50);
    list = list.filter((p) => p.name.toLowerCase().includes(cleanQ));
  }

  switch (sort) {
    case "price-asc":
      list.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      list.sort((a, b) => b.price - a.price);
      break;
    case "new":
      list.sort((a, b) => Number(b.badge === "new") - Number(a.badge === "new"));
      break;
    default:
      break;
  }

  res.json(list);
});

app.get("/api/products/:id", (req, res) => {
  const p = getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: "Product not found" });
  res.json(publicProduct(p));
});

/* ---------------- Checkout ---------------- */
app.post("/api/checkout", checkoutLimiter, async (req, res) => {
  const { items, customer, address, couponCode } = req.body || {};

  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    return res.status(400).json({ error: "Your bag is empty or contains too many items." });
  }

  const email = (customer?.email || "").toString().trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const addrName = (address?.name || "").toString().trim().slice(0, 100);
  const addrLine1 = (address?.line1 || "").toString().trim().slice(0, 150);
  const addrCity = (address?.city || "").toString().trim().slice(0, 100);
  const addrZip = (address?.zip || "").toString().trim().toUpperCase().slice(0, 20);
  const addrPhone = (address?.phone || "").toString().trim().slice(0, 30);
  const addrCountry = (address?.country || "IN").toString().trim().toUpperCase().slice(0, 5);
  const addrNotes = (address?.notes || "").toString().trim().slice(0, 300);

  if (!addrName || !addrLine1 || !addrCity || !addrZip) {
    return res.status(400).json({ error: "Complete shipping address details are required." });
  }

  /* Recompute prices server-side from catalog — NEVER trust client-submitted prices */
  const lines = [];
  let subtotal = 0;
  const ALLOWED_SIZES = ["XS", "S", "M", "L", "XL"];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      return res.status(400).json({ error: "Invalid item payload." });
    }
    const p = getProduct(item.id);
    if (!p) return res.status(400).json({ error: "Unknown product in bag." });
    if (p.inStock === false) {
      return res.status(400).json({ error: `${p.name} is out of stock.` });
    }
    const qty = Math.max(1, Math.min(10, Math.round(Number(item.qty) || 1)));
    const size = ALLOWED_SIZES.includes(item.size) ? item.size : "M";
    const price = Number(p.price);
    lines.push({ id: p.id, name: p.name, img: p.img, size, qty, price });
    subtotal += price * qty;
  }

  let discount = 0;
  let appliedCoupon = null;
  let couponVal = null;
  if (couponCode && typeof couponCode === "string" && /^[A-Z0-9_-]{2,30}$/i.test(couponCode.trim())) {
    couponVal = validateCoupon(couponCode.trim(), subtotal);
    if (couponVal.valid) {
      discount = couponVal.discount;
      appliedCoupon = couponVal.coupon.code;
    }
  }

  const taxableSubtotal = Math.max(0, subtotal - discount);
  const shipping = calcShipping(taxableSubtotal, couponVal);
  const total = Math.max(0, taxableSubtotal + shipping);

  const order = {
    id: nextOrderId(),
    accessToken: generateOrderAccessToken(),
    email,
    items: lines,
    subtotal,
    discount,
    couponCode: appliedCoupon,
    shipping,
    total,
    currency: CURRENCY,
    address: {
      name: addrName,
      line1: addrLine1,
      phone: addrPhone,
      city: addrCity,
      zip: addrZip,
      country: addrCountry,
      notes: addrNotes,
    },
    status: "pending",
    paymentRef: null,
    createdAt: new Date().toISOString(),
  };

  saveOrder(order);
  console.log(`[order] ${order.id} created (${GATEWAY} mode) — ${lines.length} item(s), ${SYMBOL}${total}`);

  /* --- Demo mode: simulate a completed payment --- */
  if (DEMO) {
    markPaid(order.id, null);
    return res.json({
      gateway: "demo",
      demo: true,
      orderId: order.id,
      token: order.accessToken,
      url: `/success.html?order=${order.id}&token=${order.accessToken}`,
    });
  }

  /* --- Razorpay mode --- */
  if (razorpay) {
    try {
      const rzpOrder = await razorpay.orders.create({
        amount: Math.round(total * 100), // paise
        currency: CURRENCY,
        receipt: order.id,
        notes: { orderId: order.id },
      });

      order.paymentRef = rzpOrder.id;
      order.razorpayOrderId = rzpOrder.id;
      saveOrder(order);

      return res.json({
        gateway: "razorpay",
        orderId: order.id,
        token: order.accessToken,
        key: rzpKeyId,
        amount: rzpOrder.amount,
        currency: CURRENCY,
        order_id: rzpOrder.id,
        prefill: { name: order.address.name, email: order.email, contact: order.address.phone },
      });
    } catch (err) {
      console.error("[razorpay] order error:", err?.message || err);
      return res.status(500).json({ error: "Could not initialize checkout. Please try again." });
    }
  }

  /* --- Stripe mode --- */
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lines.map((l) => ({
        price_data: {
          currency: "inr",
          product_data: {
            name: `${l.name} (${l.size})`,
            images: [l.img],
          },
          unit_amount: Math.round(l.price),
        },
        quantity: l.qty,
      })),
      customer_email: order.email,
      shipping_address_collection: {
        allowed_countries: ["US", "CA", "GB", "AU", "IN", "DE", "FR", "NL", "DK", "SE", "NO", "AE", "JP", "SG"],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: {
              amount: Math.round(shipping),
              currency: "inr",
            },
            display_name: shipping === 0 ? "Free shipping" : "Standard shipping",
          },
        },
      ],
      metadata: { orderId: order.id },
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&order=${order.id}&token=${order.accessToken}`,
      cancel_url: `${BASE_URL}/checkout.html?cancelled=1`,
    });

    order.paymentRef = session.id;
    order.stripeSessionId = session.id;
    saveOrder(order);

    res.json({
      gateway: "stripe",
      demo: false,
      orderId: order.id,
      token: order.accessToken,
      url: session.url,
    });
  } catch (err) {
    console.error("[stripe] checkout error:", err.message);
    res.status(500).json({ error: "Could not start checkout. Please try again." });
  }
});

/* ---------------- Razorpay signature verification ---------------- */
app.post("/api/payment/verify", (req, res) => {
  const { orderId, razorpayOrderId, paymentId, signature } = req.body || {};
  if (!orderId || !razorpayOrderId || !paymentId || !signature) {
    return res.status(400).json({ error: "Missing payment details." });
  }

  const order = getOrder(orderId);
  if (!order) return res.status(404).json({ error: "Order not found." });

  if (order.status === "paid") {
    return res.json({
      ok: true,
      already: true,
      orderId: order.id,
      token: order.accessToken,
      url: `/success.html?order=${order.id}&token=${order.accessToken}`,
    });
  }

  try {
    const secret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
    if (!secret) {
      return res.status(500).json({ error: "Payment verification unavailable." });
    }
    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpayOrderId}|${paymentId}`)
      .digest("hex");

    const a = Buffer.from(String(generatedSignature));
    const b = Buffer.from(String(signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error("Invalid signature");
    }

    const paid = markPaid(order.id, paymentId);
    console.log(`[razorpay] order ${order.id} paid (${paymentId})`);
    return res.json({
      ok: true,
      orderId: paid.id,
      token: paid.accessToken,
      url: `/success.html?order=${paid.id}&token=${paid.accessToken}`,
    });
  } catch (err) {
    console.error("[razorpay] verify error:", err.message);
    return res.status(400).json({ error: "Payment verification failed." });
  }
});

/* ---------------- Razorpay Webhook ---------------- */
app.post("/api/webhooks/razorpay", (req, res) => {
  const secret = (process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!secret) return res.status(400).json({ error: "Webhook secret not configured" });

  const signature = req.headers["x-razorpay-signature"];
  if (!signature) return res.status(400).json({ error: "Missing signature" });

  try {
    const bodyStr = JSON.stringify(req.body);
    const digest = crypto.createHmac("sha256", secret).update(bodyStr).digest("hex");
    const a = Buffer.from(String(digest));
    const b = Buffer.from(String(signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    const event = req.body;
    if (event.event === "order.paid" || event.event === "payment.captured") {
      const entity = event.payload?.payment?.entity;
      if (entity) {
        const order = getOrderBySession(entity.order_id) || getOrder(entity.notes?.orderId);
        if (order) {
          markPaid(order.id, entity.id);
          console.log(`[razorpay webhook] order ${order.id} marked paid`);
        }
      }
    }
    res.json({ status: "ok" });
  } catch (err) {
    console.error("[razorpay webhook error]:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Coupons ---------------- */
app.post("/api/coupon/validate", (req, res) => {
  const { code, subtotal } = req.body || {};
  const result = validateCoupon(code, Number(subtotal) || 0);
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result);
});

/* ---------------- Order Tracking (Requires Order ID + Customer Email) ---------------- */
app.get("/api/order/track", (req, res) => {
  const { id, email } = req.query;
  if (!id || !email) {
    return res.status(400).json({ error: "Order ID and Customer Email are both required." });
  }
  const order = getOrderByEmailAndId(String(id), String(email));
  if (!order) {
    return res.status(404).json({ error: "No matching order found. Please verify your Order ID and Email." });
  }
  res.json(maskOrderForTracking(order));
});

/* ---------------- Product Reviews ---------------- */
app.get("/api/products/:id/reviews", (req, res) => {
  res.json(getProductReviews(req.params.id));
});

app.post("/api/products/:id/reviews", reviewLimiter, (req, res) => {
  const p = getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: "Product not found." });
  const review = addProductReview(req.params.id, req.body || {});
  res.json({ ok: true, review });
});

/* ---------------- Orders (Protected via Access Token or Admin Session) ---------------- */
app.get("/api/order/session/:sid", async (req, res) => {
  const order = getOrderBySession(req.params.sid);
  if (!order) return res.status(404).json({ error: "Order not found" });

  /* If the webhook hasn't fired yet, confirm the payment directly with Stripe. */
  if (order.status !== "paid" && stripe) {
    try {
      const session = await stripe.checkout.sessions.retrieve(req.params.sid);
      if (session.payment_status === "paid") {
        return res.json(markPaid(order.id, req.params.sid));
      }
    } catch {
      /* transient Stripe error — return the stored order as-is */
    }
  }

  res.json(order);
});

app.get("/api/order/:id", (req, res) => {
  const orderId = req.params.id;
  const token = req.query.token;
  const authHeader = req.headers.authorization || "";
  const adminToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  // Allow if requester has valid admin session
  if (adminToken && isValidAdminSession(adminToken)) {
    const order = getOrder(orderId);
    if (!order) return res.status(404).json({ error: "Order not found." });
    return res.json(order);
  }

  // Otherwise, require valid order access token
  if (!token) {
    return res.status(401).json({ error: "Unauthorized. Order access token required." });
  }

  const order = getOrderByToken(orderId, token);
  if (!order) {
    return res.status(404).json({ error: "Order not found or access token invalid." });
  }

  res.json(order);
});

/* ---------------- Newsletter ---------------- */
app.post("/api/newsletter", newsletterLimiter, (req, res) => {
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  const result = addNewsletter(email);
  res.json({ ok: true, ...result });
});

/* ---------------- Admin ---------------- */
app.use("/api/admin", adminRouter);

/* ---------------- Static frontend ---------------- */
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

/* API 404 fallback */
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

function startServer(port) {
  const server = app.listen(port, () => {
    console.log("");
    console.log("  ┌─────────────────────────────────────────────┐");
    console.log("  │  NOIR — Studio Apparel                      │");
    console.log(`  │  → http://localhost:${port}                     │`);
    console.log(`  │  Admin → http://localhost:${port}/admin.html       │`);
    console.log(`  │  Mode: ${GATEWAY === "razorpay" ? "RAZORPAY (real payments)" : GATEWAY === "stripe" ? "STRIPE (live checkout)" : "DEMO (simulated payments)"}`);
    console.log("  └─────────────────────────────────────────────┘");
    console.log("");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`  ⚠️ Port ${port} is busy. Retrying on ${port + 1}...`);
      server.close(() => startServer(port + 1));
      return;
    }
    throw err;
  });
}

if (process.env.NODE_ENV !== "test" && !process.env.VERCEL) {
  startServer(Number(PORT));
}

export default app;
