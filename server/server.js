/* ============================================================
   NOIR — Express backend
   Endpoints:
     GET  /api/config
     GET  /api/products?cat=&sort=&q=
     GET  /api/products/:id
     POST /api/checkout
     POST /api/payment/verify       (Razorpay signature verification)
     GET  /api/order/session/:sid
     GET  /api/order/:id
     POST /api/newsletter
     POST /api/admin/auth
     ...  /api/admin/*      (product & order management)
     POST /api/webhooks/stripe
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
  saveOrder,
  getOrder,
  getOrderBySession,
  getOrderByEmailAndId,
  markPaid,
  addNewsletter,
  validateCoupon,
  getProductReviews,
  addProductReview,
} from "./db.js";
import adminRouter from "./admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 4000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CURRENCY = "INR";
const SYMBOL = "₹";
const FREE_SHIPPING = 10200; // in ₹ (was $120 @ ₹85)
const SHIPPING_FEE = 680;    // in ₹ (was $8 @ ₹85)

const stripe =
  process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim()
    ? new Stripe(process.env.STRIPE_SECRET_KEY.trim())
    : null;

const razorpay =
  process.env.RAZORPAY_KEY_ID &&
  process.env.RAZORPAY_KEY_SECRET &&
  process.env.RAZORPAY_KEY_ID.trim() &&
  process.env.RAZORPAY_KEY_SECRET.trim()
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID.trim(),
        key_secret: process.env.RAZORPAY_KEY_SECRET.trim(),
      })
    : null;

/* Gateway priority: Razorpay > Stripe > demo */
const GATEWAY = razorpay ? "razorpay" : stripe ? "stripe" : "demo";
const DEMO = GATEWAY === "demo";

if (!process.env.ADMIN_PASSWORD) {
  console.warn("  ⚠️  ADMIN_PASSWORD not set — admin panel uses default password \"noir-admin\". Set ADMIN_PASSWORD in .env!");
}

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

app.use(express.json());

/* ---------------- Helpers ---------------- */
function calcShipping(subtotal) {
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
    razorpayKeyId: razorpay ? process.env.RAZORPAY_KEY_ID.trim() : null,
    stripePublicKey: !razorpay && stripe ? (process.env.STRIPE_PUBLISHABLE_KEY || null) : null,
    freeShipping: FREE_SHIPPING,
    shippingFee: SHIPPING_FEE,
  });
});

/* ---------------- Products ---------------- */
app.get("/api/products", (req, res) => {
  let list = listProducts().map(publicProduct);

  const { cat, q, sort } = req.query;
  if (cat && cat !== "all") list = list.filter((p) => p.cat === cat);
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

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
app.post("/api/checkout", async (req, res) => {
  const { items, customer, address, couponCode } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Your bag is empty." });
  }
  if (!customer?.email || !/^\S+@\S+\.\S+$/.test(customer.email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  if (!address?.name || !address?.line1 || !address?.city || !address?.zip) {
    return res.status(400).json({ error: "Complete shipping details are required." });
  }

  /* Recompute prices server-side — never trust the client. */
  const lines = [];
  let subtotal = 0;
  for (const item of items) {
    const p = getProduct(item.id);
    if (!p) return res.status(400).json({ error: "Unknown product in bag." });
    if (p.inStock === false) {
      return res.status(400).json({ error: `${p.name} is out of stock.` });
    }
    const qty = Math.max(1, Math.min(10, Math.round(item.qty || 1)));
    const price = p.price;
    lines.push({ id: p.id, name: p.name, img: p.img, size: item.size || "M", qty, price });
    subtotal += price * qty;
  }

  let discount = 0;
  let appliedCoupon = null;
  if (couponCode) {
    const val = validateCoupon(couponCode, subtotal);
    if (val.valid) {
      discount = val.discount;
      appliedCoupon = val.coupon.code;
    }
  }

  const taxableSubtotal = Math.max(0, subtotal - discount);
  const shipping = calcShipping(taxableSubtotal);
  const total = Math.max(0, taxableSubtotal + shipping);

  const order = {
    id: nextOrderId(),
    email: customer.email.trim().toLowerCase(),
    items: lines,
    subtotal,
    discount,
    couponCode: appliedCoupon,
    shipping,
    total,
    currency: CURRENCY,
    address: {
      name: address.name.trim(),
      line1: address.line1.trim(),
      phone: (address.phone || "").trim(),
      city: address.city.trim(),
      zip: address.zip.trim().toUpperCase(),
      country: (address.country || "IN").trim().toUpperCase(),
      notes: (address.notes || "").trim(),
    },
    status: "pending",
    paymentRef: null,
    createdAt: new Date().toISOString(),
  };

  saveOrder(order);
  console.log(`[order] ${order.id} created (${GATEWAY} mode) — ${lines.length} line(s), ${SYMBOL}${total}`);

  /* --- Demo mode: simulate a completed payment --- */
  if (DEMO) {
    markPaid(order.id, null);
    return res.json({ gateway: "demo", demo: true, orderId: order.id, url: `/success.html?order=${order.id}` });
  }

  /* --- Razorpay mode: create an order and open their hosted checkout --- */
  if (razorpay) {
    try {
      const rzpOrder = await razorpay.orders.create({
        amount: Math.round(total * 100), // in paise
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
        key: process.env.RAZORPAY_KEY_ID.trim(),
        amount: rzpOrder.amount,
        currency: CURRENCY,
        order_id: rzpOrder.id,
        prefill: { name: order.address.name, email: order.email, contact: order.address.phone },
      });
    } catch (err) {
      console.error("[razorpay] order error:", err.message);
      return res.status(500).json({ error: "Could not start checkout. Please try again." });
    }
  }

  /* --- Stripe mode: create a hosted Checkout Session (fallback) --- */
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
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/checkout.html?cancelled=1`,
    });

    order.paymentRef = session.id;
    order.stripeSessionId = session.id;
    saveOrder(order);

    res.json({ gateway: "stripe", demo: false, orderId: order.id, url: session.url });
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
    return res.json({ ok: true, already: true, url: `/success.html?order=${order.id}` });
  }

  try {
    const secret = process.env.RAZORPAY_KEY_SECRET ? process.env.RAZORPAY_KEY_SECRET.trim() : "";
    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpayOrderId}|${paymentId}`)
      .digest("hex");

    if (generatedSignature !== signature) {
      throw new Error("Invalid signature");
    }

    const paid = markPaid(order.id, paymentId);
    console.log(`[razorpay] order ${order.id} paid (${paymentId})`);
    return res.json({ ok: true, orderId: paid.id, url: `/success.html?order=${paid.id}` });
  } catch (err) {
    console.error("[razorpay] verify error:", err.message);
    return res.status(400).json({ error: "Payment verification failed." });
  }
});

/* ---------------- Razorpay Webhook ---------------- */
app.post("/api/webhooks/razorpay", (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return res.status(400).json({ error: "Webhook secret not configured" });

  const signature = req.headers["x-razorpay-signature"];
  if (!signature) return res.status(400).json({ error: "Missing signature" });

  try {
    const bodyStr = JSON.stringify(req.body);
    const shasum = crypto.createHmac("sha256", secret.trim());
    shasum.update(bodyStr);
    const digest = shasum.digest("hex");
    if (digest !== signature) {
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
  const result = validateCoupon(code, subtotal || 0);
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result);
});

/* ---------------- Order Tracking ---------------- */
app.get("/api/order/track", (req, res) => {
  const { id, email } = req.query;
  if (!id || !email) {
    return res.status(400).json({ error: "Order ID and Email are required." });
  }
  const order = getOrderByEmailAndId(id, email);
  if (!order) {
    return res.status(404).json({ error: "No matching order found. Please verify your Order ID and Email." });
  }
  res.json(order);
});

/* ---------------- Product Reviews ---------------- */
app.get("/api/products/:id/reviews", (req, res) => {
  res.json(getProductReviews(req.params.id));
});

app.post("/api/products/:id/reviews", (req, res) => {
  const review = addProductReview(req.params.id, req.body || {});
  res.json({ ok: true, review });
});

/* ---------------- Orders ---------------- */
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
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

/* ---------------- Newsletter ---------------- */
app.post("/api/newsletter", (req, res) => {
  const email = (req.body?.email || "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
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
