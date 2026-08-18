/* ============================================================
   NOIR — Automated Security Regression & Verification Test Suite
   Run via: npm test
   ============================================================ */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set up isolated test environment
process.env.NODE_ENV = "test";
const TEST_ADMIN_PASSWORD = "Strong-Test-Password-2026!#";
process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;

// Import Express app after setting env
const { default: app } = await import("../server/server.js");
const { getProductReviews, addProductReview, getOrder } = await import("../server/db.js");
const { getProduct } = await import("../server/products-store.js");

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* Helper for HTTP requests */
async function req(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, data };
}

/* ============================================================
   1. ADMIN AUTHENTICATION TESTS
   ============================================================ */
describe("1. Admin Authentication Hardening", () => {
  test("Rejects default password 'admin'", async () => {
    const res = await req("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin" }),
    });
    assert.strictEqual(res.status, 401);
    assert.match(res.data.error, /Invalid credentials/i);
  });

  test("Rejects default password 'noir-admin'", async () => {
    const res = await req("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "noir-admin" }),
    });
    assert.strictEqual(res.status, 401);
  });

  test("Rejects raw password as Bearer token", async () => {
    const res = await req("/api/admin/products", {
      headers: { Authorization: "Bearer admin" },
    });
    assert.strictEqual(res.status, 401);
  });

  test("Rejects raw configured password as Bearer token without login session", async () => {
    const res = await req("/api/admin/products", {
      headers: { Authorization: `Bearer ${TEST_ADMIN_PASSWORD}` },
    });
    assert.strictEqual(res.status, 401);
  });

  test("Rejects query-string token parameter (?token=...)", async () => {
    const res = await req("/api/admin/products?token=admin");
    assert.strictEqual(res.status, 401);
  });

  test("Rejects unauthenticated access to /api/admin/orders", async () => {
    const res = await req("/api/admin/orders");
    assert.strictEqual(res.status, 401);
  });

  test("Rejects unauthenticated access to /api/admin/newsletter", async () => {
    const res = await req("/api/admin/newsletter");
    assert.strictEqual(res.status, 401);
  });

  test("Rejects unauthenticated access to /api/admin/coupons", async () => {
    const res = await req("/api/admin/coupons");
    assert.strictEqual(res.status, 401);
  });

  test("Successful login issues high-entropy session token and allows admin operations", async () => {
    const loginRes = await req("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
    });

    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.data.ok, true);
    assert.ok(loginRes.data.token && typeof loginRes.data.token === "string");
    assert.strictEqual(loginRes.data.token.length, 64); // 32-byte hex

    const sessionToken = loginRes.data.token;

    // Authorized request with session token
    const prodRes = await req("/api/admin/products", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.strictEqual(prodRes.status, 200);
    assert.ok(Array.isArray(prodRes.data));

    // Test logout revokes token
    const logoutRes = await req("/api/admin/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.strictEqual(logoutRes.status, 200);

    // Subsequent request with revoked token must fail
    const revokedRes = await req("/api/admin/products", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.strictEqual(revokedRes.status, 401);
  });
});

/* ============================================================
   2. STORED XSS & OUTPUT ENCODING TESTS
   ============================================================ */
describe("2. Stored XSS Mitigation", () => {
  test("HTML escaping utility encodes all dangerous XSS characters", () => {
    function escapeHtml(str) {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;")
        .replace(/\//g, "&#x2F;");
    }

    const payload = '<script>alert("XSS")</script><img src=x onerror=\'evil()\'/>';
    const escaped = escapeHtml(payload);
    assert.strictEqual(escaped.includes("<script>"), false);
    assert.strictEqual(escaped.includes("<img"), false);
    assert.strictEqual(escaped.includes('"'), false);
    assert.strictEqual(escaped.includes("'"), false);
    assert.ok(escaped.includes("&lt;script&gt;"));
    assert.ok(escaped.includes("&quot;XSS&quot;"));
  });

  test("Order with malicious XSS name payload is safely accepted and stored as inert text", async () => {
    const xssPayload = '<img src=x onerror="fetch(\'/api/admin/products\',{method:\'DELETE\'})">';
    const checkoutRes = await req("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: 1, size: "M", qty: 1 }],
        customer: { email: "victim@example.com" },
        address: {
          name: xssPayload,
          line1: "123 Safe St",
          city: "Mumbai",
          zip: "400001",
          country: "IN",
        },
      }),
    });

    assert.strictEqual(checkoutRes.status, 200);
    const orderId = checkoutRes.data.orderId;
    const token = checkoutRes.data.token;

    // Retrieve order and verify payload is stored as inert raw string (not executed)
    const order = getOrder(orderId);
    assert.strictEqual(order.address.name, xssPayload);
  });

  test("Review with script tag payload is sanitized and bounded", async () => {
    const reviewRes = await req("/api/products/1/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: '<script>alert("attacker")</script>',
        rating: 5,
        comment: '<b onmouseover="alert(1)">Great fabric!</b>',
      }),
    });

    assert.strictEqual(reviewRes.status, 200);
    assert.ok(reviewRes.data.ok);
    const reviews = getProductReviews(1);
    const latest = reviews[0];
    assert.ok(latest.name.length <= 60);
    assert.ok(latest.comment.length <= 500);
  });
});

/* ============================================================
   3. ORDER IDOR & DATA DISCLOSURE TESTS
   ============================================================ */
describe("3. Order IDOR Protection & Access Control", () => {
  let createdOrderId;
  let createdOrderToken;

  before(async () => {
    const checkoutRes = await req("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: 1, size: "M", qty: 1 }],
        customer: { email: "customer.secure@example.com" },
        address: {
          name: "Alice Security",
          line1: "42 Confidential Ave",
          phone: "+91 9876543210",
          city: "Bengaluru",
          zip: "560001",
          country: "IN",
        },
      }),
    });
    createdOrderId = checkoutRes.data.orderId;
    createdOrderToken = checkoutRes.data.token;
  });

  test("Unauthenticated GET /api/order/:id without token is rejected (401)", async () => {
    const res = await req(`/api/order/${createdOrderId}`);
    assert.strictEqual(res.status, 401);
    assert.match(res.data.error, /Order access token required/i);
  });

  test("GET /api/order/:id with forged/incorrect token is rejected (404)", async () => {
    const res = await req(`/api/order/${createdOrderId}?token=wrong_invalid_token_123`);
    assert.strictEqual(res.status, 404);
  });

  test("GET /api/order/:id with valid accessToken succeeds", async () => {
    const res = await req(`/api/order/${createdOrderId}?token=${createdOrderToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.id, createdOrderId);
    assert.strictEqual(res.data.email, "customer.secure@example.com");
  });

  test("GET /api/order/track without email parameter is rejected (400)", async () => {
    const res = await req(`/api/order/track?id=${createdOrderId}`);
    assert.strictEqual(res.status, 400);
  });

  test("GET /api/order/track with incorrect email returns 404", async () => {
    const res = await req(`/api/order/track?id=${createdOrderId}&email=wrong@stranger.com`);
    assert.strictEqual(res.status, 404);
  });

  test("GET /api/order/track with matching email returns masked tracking view", async () => {
    const res = await req(`/api/order/track?id=${createdOrderId}&email=customer.secure@example.com`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.id, createdOrderId);
    assert.strictEqual(res.data.address.maskedName, "A***");
    assert.strictEqual(res.data.email, undefined); // Sensitive customer email not leaked in tracking payload
  });
});

/* ============================================================
   4. CHECKOUT INTEGRITY & ANTI-TAMPERING TESTS
   ============================================================ */
describe("4. Checkout Anti-Tampering & Validation", () => {
  test("Client cannot manipulate item prices in checkout payload", async () => {
    const catalogProduct = getProduct(1);
    const catalogPrice = catalogProduct.price;
    const res = await req("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: 1, size: "M", qty: 1, price: 1 }], // Attacker tries to pay ₹1
        customer: { email: "price.tamper@example.com" },
        address: {
          name: "Test User",
          line1: "123 Main St",
          city: "Delhi",
          zip: "110001",
        },
      }),
    });

    assert.strictEqual(res.status, 200);
    const order = getOrder(res.data.orderId);
    assert.strictEqual(order.items[0].price, catalogPrice); // Verified recomputed from catalog
    assert.ok(order.total >= catalogPrice);
  });

  test("Rejects empty shopping bag checkout", async () => {
    const res = await req("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [],
        customer: { email: "test@example.com" },
        address: { name: "User", line1: "Street", city: "City", zip: "00000" },
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  test("Rejects invalid email format in checkout", async () => {
    const res = await req("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: 1, size: "M", qty: 1 }],
        customer: { email: "invalid-email-address" },
        address: { name: "User", line1: "Street", city: "City", zip: "00000" },
      }),
    });
    assert.strictEqual(res.status, 400);
  });

  test("Rejects checkout with missing required address fields", async () => {
    const res = await req("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ id: 1, size: "M", qty: 1 }],
        customer: { email: "test@example.com" },
        address: { name: "User" }, // missing line1, city, zip
      }),
    });
    assert.strictEqual(res.status, 400);
  });
});

/* ============================================================
   5. SECRET SCANNING & REPOSITORY HYGIENE TESTS
   ============================================================ */
describe("5. Secret Hygiene Verification", () => {
  test("No API KEYS.txt file exists in the workspace", () => {
    const keyFilePath = path.join(__dirname, "..", "API KEYS.txt");
    assert.strictEqual(fs.existsSync(keyFilePath), false);
  });

  test(".env.example contains only variable names and zero live credentials", () => {
    const envExample = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
    assert.strictEqual(envExample.includes("rzp_live_"), false);
    assert.strictEqual(envExample.includes("sk_live_"), false);
    assert.strictEqual(envExample.includes("noir-admin"), false);
  });

  test(".gitignore contains .env, *KEYS*.txt, and secret exclusions", () => {
    const gitignore = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
    assert.ok(gitignore.includes(".env"));
    assert.ok(gitignore.includes("*KEYS*.txt"));
  });

  test("Server files contain zero hardcoded live secret fallbacks", () => {
    const serverJs = fs.readFileSync(path.join(__dirname, "..", "server", "server.js"), "utf8");
    assert.strictEqual(serverJs.includes("rzp_live_"), false);
    assert.strictEqual(serverJs.includes("sk_live_"), false);
  });
});

/* ============================================================
   6. SECURITY HEADERS VERIFICATION
   ============================================================ */
describe("6. Production Security Headers", () => {
  test("Responses include X-Content-Type-Options: nosniff", async () => {
    const res = await req("/api/config");
    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
  });

  test("Responses include X-Frame-Options: SAMEORIGIN", async () => {
    const res = await req("/api/config");
    assert.strictEqual(res.headers.get("x-frame-options"), "SAMEORIGIN");
  });

  test("Responses include Content-Security-Policy", async () => {
    const res = await req("/api/config");
    const csp = res.headers.get("content-security-policy");
    assert.ok(csp && csp.includes("default-src 'self'"));
  });
});
