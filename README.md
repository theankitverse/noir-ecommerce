# NOIR — Studio Apparel Store

A fully working ecommerce site: product catalog, shopping bag, wishlist, payments in INR via **Razorpay** (with Stripe or demo as fallback), and an admin panel to manage products and orders. Node.js + Express backend, plain-JS frontend, JSON file storage.

## Quick start

```bash
npm install
npm run dev        # starts http://localhost:4000 (auto-restarts on changes)
```

Open `http://localhost:4000` — the store works immediately in **demo mode** (checkout is simulated and orders are marked paid).

Admin panel: `http://localhost:4000/admin.html` (default password `noir-admin`).

## Turning on real payments (Razorpay — India)

The store picks its gateway automatically by priority: **Razorpay > Stripe > demo**.

1. Create an account at [dashboard.razorpay.com](https://dashboard.razorpay.com) → Settings → API Keys → Generate Key.
2. Copy `.env.example` to `.env` and fill in the **test-mode** keys:
   ```
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   ```
3. Restart the server (`npm run dev`). The startup banner will now say **RAZORPAY (real payments)** and customers pay in ₹ through Razorpay's hosted checkout (UPI, cards, net banking, wallets).
4. When ready to go live: flip to the **live** `rzp_live_...` keys and set `BASE_URL` to your real domain.

Razorpay test details: use the **Test mode** UPI IDs / card numbers listed in your Razorpay dashboard (e.g. `success@razorpay` for UPI or `4111 1111 1111 1111` for cards, any future expiry, any CVC).

## Turning on real payments (Stripe — fallback)

1. Create a free account at [stripe.com](https://stripe.com) → Dashboard → Developers → API keys.
2. Copy `.env.example` to `.env` and fill in your **test-mode** keys:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```
3. Restart the server (`npm run dev`). With no Razorpay keys set, the startup banner will say **STRIPE (live checkout)** and customers pay through Stripe's hosted Checkout page (in INR).
4. (Optional but recommended) Make Stripe notify you of payments: install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and run:
   ```bash
   stripe listen --forward-to localhost:4000/api/webhooks/stripe
   ```
   Copy the printed `whsec_...` into `.env` as `STRIPE_WEBHOOK_SECRET`.
5. When ready to go live: flip the key to the **live** `sk_live_...` keys and set `BASE_URL` to your real domain.

Stripe demo test cards: `4242 4242 4242 4242`, any future expiry, any CVC.

> Note: this store is configured for **INR** (prices in ₹, shipping fee ₹680, free shipping over ₹10,200).

## Adding new products

**Easiest — Admin panel** (`/admin.html` → Products → *+ Add product*): name, price, category, image URL, etc. It updates instantly, no code or restart needed.

**Or edit the file directly:** `server/products.json` is the live catalog. Add an entry by copying an existing one and changing the `id`. On save the store picks it up immediately (dev mode auto-restarts).

A product entry looks like:

```json
{
  "id": 11,
  "name": "Raw Denim Jacket",
  "cat": "outerwear",
  "price": 12665,
  "compare": null,
  "badge": "new",
  "rating": 4.7,
  "reviews": 89,
  "colors": [{ "name": "Indigo", "hex": "#2b3a67" }],
  "fabric": "12oz raw selvedge denim",
  "care": ["Cold wash", "Hang dry"],
  "desc": "A sturdy everyday jacket...",
  "img": "https://images.unsplash.com/photo-...?w=800&q=80&auto=format&fit=crop",
  "hover": "https://...",
  "gallery": ["https://...", "https://..."],
  "inStock": true
}
```

Notes:
- `id` must be unique (the admin panel auto-assigns the next one).
- `price` is in **INR** (whole rupees — no decimals).
- Images: use free image hosts like **Unsplash** (`images.unsplash.com/photo-...?w=800&q=80&auto=format&fit=crop`) or any direct image URL.
- `cat` is one of: `tops`, `bottoms`, `outerwear`, `accessories`.
- Setting `"inStock": false` shows the item as "Out of stock" and blocks checkout.

## Managing orders

`/admin.html` → **Orders**: see every order (customer, items, total, status) and move it through `pending → paid → shipped → delivered` (or `cancelled` / `refunded`).

## API reference

| Method | Path | Description |
|---|---|---|
| GET | `/api/config` | Store config (gateway, currency, shipping) |
| GET | `/api/products` | Catalog (`?cat=&q=&sort=`) |
| GET | `/api/products/:id` | One product |
| POST | `/api/checkout` | Place an order (Razorpay, Stripe or demo) |
| POST | `/api/payment/verify` | Verify a Razorpay payment signature |
| GET | `/api/order/:id` | Look up an order |
| GET | `/api/order/session/:sid` | Look up order by Stripe session |
| POST | `/api/newsletter` | Save a newsletter signup |
| POST | `/api/admin/auth` | Admin login (`{ password }`) |
| GET/POST/PUT/DELETE | `/api/admin/products` | Manage products (Bearer token) |
| GET/PATCH | `/api/admin/orders` | Manage orders (Bearer token) |
| GET | `/api/admin/newsletter` | Newsletter signups (Bearer token) |
| POST | `/api/webhooks/stripe` | Stripe webhook (marks orders paid) |

## Scripts

- `npm start` — run in production
- `npm run dev` — run with auto-restart
- `npm run seed` — reset the catalog and order database

## Storage

- `server/products.json` — product catalog (editable)
- `server/db.json` — orders, sequence, newsletter signups

## Security notes

- Set `ADMIN_PASSWORD` in `.env` before deploying anywhere public (default is `noir-admin`).
- Never commit your `.env` — it's git-ignored.
- Server-side, prices are recomputed from the catalog — clients can't underpay.
