/* ==========================================================================
   NOIR — checkout page (checkout.html)
   ========================================================================== */

const S = window.Store;
const $ = S.$;
const $$ = S.$$;
const esc = S.escapeHtml;

let config = { gateway: "demo", demo: true, freeShipping: 10200, shippingFee: 680 };
let products = [];

const CATS = { tops: "Tops", bottoms: "Bottoms", outerwear: "Outerwear", accessories: "Accessories" };

const gateway = () => config.gateway || (config.demo ? "demo" : "stripe");

/* ---------------- Boot ---------------- */
async function init() {
  try {
    [config, products] = await Promise.all([S.getConfig(), S.api("/products")]);
  } catch (e) {
    S.showToast(e.message);
  }

  updateCounters();
  renderSummary();
  renderPaymentUI();
  renderDrawer();

  if (new URLSearchParams(location.search).get("cancelled")) {
    S.showToast("Payment cancelled — your bag is still here.");
  }
}

/* ---------------- Cart summary ---------------- */
function enrichedItems() {
  return S.getCart()
    .map((item) => {
      const p = products.find((x) => x.id === item.id);
      return { ...item, cat: p ? CATS[p.cat] : "", img: p ? p.img : item.img };
    })
    .filter((i) => i.cat);
}

let activeCoupon = null;
let activeCouponObj = null;
let discountAmount = 0;

function totals() {
  const subtotal = S.cartSubtotal();
  const discount = discountAmount || 0;
  const taxable = Math.max(0, subtotal - discount);
  const cCode = (activeCouponObj?.code || activeCoupon || "").toString().toUpperCase();
  const cType = (activeCouponObj?.type || "").toString().toLowerCase();
  const isFreeShipCoupon = cType === "shipping" || cType === "freeship" || ["FREESHIP", "ZEROSHIP", "TESTSHIP"].includes(cCode);
  const shipping = subtotal === 0 || isFreeShipCoupon || taxable >= config.freeShipping ? 0 : config.shippingFee;
  return { subtotal, discount, shipping, total: Math.max(0, taxable + shipping) };
}

function renderSummary() {
  const items = enrichedItems();
  const { subtotal, discount, shipping, total } = totals();

  $("#summaryItems").innerHTML = items.length
    ? items
        .map(
          (i) => `
        <div class="co-summary__item">
          <img src="${esc(i.img)}" alt="${esc(i.name)}" />
          <div>
            <p class="co-summary__item-name">${esc(i.name)}</p>
            <p class="co-summary__item-meta">${esc(i.cat)} · Size ${esc(i.size)} · Qty ${Number(i.qty) || 1}</p>
          </div>
          <span class="co-summary__item-price">${S.fmt((i.price || 0) * (i.qty || 1))}</span>
        </div>`
        )
        .join("")
    : `<p class="co-summary__item-name">Your bag is empty.</p>`;

  $("#sumSubtotal").textContent = S.fmt(subtotal);

  if (discount > 0) {
    $("#discountLine").hidden = false;
    $("#sumDiscount").textContent = `−${S.fmt(discount)}`;
  } else {
    $("#discountLine").hidden = true;
  }

  $("#sumShipping").textContent = shipping === 0 ? "Free" : S.fmt(shipping);
  $("#sumTotal").textContent = S.fmt(total);
  $("#sumPromo").textContent = shipping === 0 && subtotal > 0 ? "You've unlocked free shipping ✦" : "";
  $("#sumPromo").hidden = shipping !== 0 || subtotal === 0;

  const totalText = S.fmt(total);
  $("#stripeAmount").textContent = totalText;
  $("#demoAmount").textContent = totalText;
  $("#razorpayAmount").textContent = totalText;
  $$(".directUpiAmount").forEach((el) => (el.textContent = totalText));

  // Update dynamic UPI QR Code
  const upiVpa = "noirkart889658.rzp@rxairtel";
  const upiUri = `upi://pay?pa=${upiVpa}&pn=NOIR%20Atelier&am=${total}&cu=INR&tn=NOIR%20Order`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiUri)}`;
  const qrImg = $("#upiQrImg");
  if (qrImg) qrImg.src = qrUrl;

  const empty = !items.length;
  $("#payStripeBtn").disabled = empty;
  $("#demoPayBtn").disabled = empty;
  $("#payRazorpayBtn").disabled = empty;
  if ($("#payDirectUpiBtn")) $("#payDirectUpiBtn").disabled = empty;
}

let pollTimer = null;
function startOrderPolling(orderId, email) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const track = await S.api(`/order/track?id=${orderId}&email=${encodeURIComponent(email)}`);
      if (track && track.status && track.status !== "pending") {
        clearInterval(pollTimer);
        S.clearCart();
        location.href = `/success.html?order=${orderId}`;
      }
    } catch {
      /* continue polling */
    }
  }, 3000);
}

/* ---------------- Direct UPI & QR Handler ---------------- */
async function placeDirectUpiOrder() {
  if (!enrichedItems().length) return S.showToast("Your bag is empty.");
  if (!validate()) {
    S.showToast("Please complete the highlighted fields.");
    return;
  }

  const btn = $("#payDirectUpiBtn");
  btn.disabled = true;
  btn.textContent = "Confirming UPI Payment…";

  const payload = collectPayload();
  const userVpa = $("#upiUserVpa")?.value.trim() || "";
  payload.upiVpa = userVpa;

  try {
    const res = await S.api("/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    startOrderPolling(res.orderId, payload.customer.email);

    S.showToast("Payment recorded! Redirecting to confirmation…");
    S.clearCart();
    setTimeout(() => {
      location.href = `/success.html?order=${res.orderId}`;
    }, 1000);
  } catch (e) {
    S.showToast(e.message || "Could not confirm UPI order.");
    btn.disabled = false;
    btn.textContent = `I Have Paid via UPI · Confirm Order (${S.fmt(totals().total)})`;
  }
}

/* ---------------- Coupon Handler ---------------- */
async function applyCoupon() {
  const code = $("#couponInput").value.trim();
  const msgEl = $("#couponMsg");
  if (!code) {
    msgEl.hidden = false;
    msgEl.style.color = "var(--c-accent, #d2542f)";
    msgEl.textContent = "Please enter a promo code.";
    return;
  }

  try {
    const res = await S.api("/coupon/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, subtotal: S.cartSubtotal() }),
    });

    if (res.valid) {
      activeCouponObj = res.coupon;
      activeCoupon = res.coupon.code;
      discountAmount = res.discount;
      msgEl.hidden = false;
      msgEl.style.color = "#2b7a4b";
      msgEl.textContent = `Coupon ${res.coupon.code} applied! ${res.coupon.desc || ""}`;
      renderSummary();
    }
  } catch (err) {
    activeCouponObj = null;
    activeCoupon = null;
    discountAmount = 0;
    msgEl.hidden = false;
    msgEl.style.color = "var(--c-accent, #d2542f)";
    msgEl.textContent = err.message || "Invalid coupon code.";
    renderSummary();
  }
}

/* ---------------- Payment UI ---------------- */
function renderPaymentUI() {
  const g = gateway();
  $("#payRazorpay").hidden = g !== "razorpay";
  $("#payStripe").hidden = g !== "stripe";
  $("#payDemo").hidden = g !== "demo";
  $("#gatewayName").textContent =
    g === "razorpay" ? "Powered by Razorpay" :
    g === "stripe" ? "Powered by Stripe" :
    "Demo checkout — add Razorpay keys to accept payments";
}

/* ---------------- Validation ---------------- */
function setErr(field, show) {
  field.closest(".field").classList.toggle("has-error", show);
  field.closest(".field").querySelector(".err").hidden = !show;
}

function validate() {
  let ok = true;
  const email = $("#coEmail");
  const valid = (f) => (f.value.trim().length > 0);
  const pairs = [
    [email, email.value && /^\S+@\S+\.\S+$/.test(email.value)],
    [$("#coName"), valid($("#coName"))],
    [$("#coLine1"), valid($("#coLine1"))],
    [$("#coCity"), valid($("#coCity"))],
    [$("#coZip"), valid($("#coZip"))],
  ];
  pairs.forEach(([f, good]) => { setErr(f, !good); if (!good) ok = false; });
  return ok;
}

function collectPayload() {
  const items = enrichedItems().map(({ id, size, qty }) => ({ id, size, qty }));
  return {
    items,
    customer: { email: $("#coEmail").value.trim() },
    couponCode: activeCoupon,
    address: {
      name: $("#coName").value.trim(),
      line1: $("#coLine1").value.trim(),
      phone: $("#coPhone").value.trim(),
      city: $("#coCity").value.trim(),
      zip: $("#coZip").value.trim(),
      country: $("#coCountry").value,
      notes: $("#coNotes").value.trim(),
    },
  };
}

async function placeOrder() {
  if (!enrichedItems().length) return S.showToast("Your bag is empty.");
  if (!validate()) {
    S.showToast("Please complete the highlighted fields.");
    return;
  }

  const payload = collectPayload();

  if (gateway() === "razorpay") return placeRazorpayOrder(payload);

  const btn = gateway() === "stripe" ? $("#payStripeBtn") : $("#demoPayBtn");
  btn.disabled = true;
  btn.textContent = "Processing…";

  try {
    const res = await S.api("/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.gateway === "stripe") {
      /* Stripe — redirect to hosted checkout. */
      location.href = res.url;
    } else {
      /* Demo mode — order already marked paid server-side. */
      S.clearCart();
      location.href = res.url;
    }
  } catch (e) {
    S.showToast(e.message);
    btn.disabled = false;
    btn.textContent = `Pay ${S.fmt(totals().total)}`;
  }
}

/* ---------------- Razorpay ---------------- */
let razorpayScript = null;
function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScript) return razorpayScript;
  razorpayScript = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment gateway. Check your connection."));
    document.head.appendChild(s);
  });
  return razorpayScript;
}

function razorpayButtonText() {
  return `Pay ${S.fmt(totals().total)}`;
}

async function placeRazorpayOrder(payload) {
  const btn = $("#payRazorpayBtn");
  btn.disabled = true;
  btn.textContent = "Contacting Razorpay…";
  try {
    const res = await S.api("/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.gateway !== "razorpay") throw new Error("Payment gateway not available.");
    await loadRazorpayScript();
    btn.textContent = "Opening secure window…";

    if (res.orderId && res.prefill?.email) {
      startOrderPolling(res.orderId, res.prefill.email);
    }

    const rawPhone = (res.prefill?.contact || "").replace(/\D/g, "");
    const cleanContact = rawPhone.length >= 10 ? rawPhone.slice(-10) : rawPhone;

    const options = {
      key: res.key,
      amount: res.amount,
      currency: res.currency,
      name: "NOIR Atelier",
      description: `Order ${res.orderId}`,
      order_id: res.order_id,
      prefill: {
        name: res.prefill?.name || "",
        email: res.prefill?.email || "",
        contact: cleanContact,
      },
      theme: { color: "#141312" },
      notes: { orderId: res.orderId },
      config: {
        display: {
          blocks: {
            upi: {
              name: "Pay via UPI / QR Code",
              instruments: [
                {
                  method: "upi",
                },
              ],
            },
          },
          sequence: ["block.upi", "block.other"],
          preferences: {
            show_default_blocks: true,
          },
        },
      },
      handler: async (payRes) => {
        btn.textContent = "Verifying payment…";
        try {
          const v = await S.api("/payment/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId: res.orderId,
              razorpayOrderId: payRes.razorpay_order_id,
              paymentId: payRes.razorpay_payment_id,
              signature: payRes.razorpay_signature,
            }),
          });
          if (v.ok) {
            S.clearCart();
            location.href = v.url;
          } else {
            throw new Error("Payment verification failed.");
          }
        } catch (e) {
          S.showToast(e.message || "Payment could not be confirmed.");
          btn.disabled = false;
          btn.textContent = razorpayButtonText();
        }
      },
      modal: {
        escape: true,
        ondismiss: () => {
          btn.disabled = false;
          btn.textContent = razorpayButtonText();
        },
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.open();
  } catch (e) {
    S.showToast(e.message);
    btn.disabled = false;
    btn.textContent = razorpayButtonText();
  }
}

/* ---------------- Handlers ---------------- */
/* Enter inside an input must not reload the page via implicit submit */
$("#checkoutForm").addEventListener("submit", (e) => e.preventDefault());

$("#applyCouponBtn").addEventListener("click", applyCoupon);
$("#couponInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    applyCoupon();
  }
});

/* Direct UPI & Gateway Tab Listeners */
$("#tabUpiDirect")?.addEventListener("click", () => {
  $("#tabUpiDirect").className = "btn btn--solid";
  $("#tabRazorpayModal").className = "btn btn--ghost";
  $("#blockUpiDirect").hidden = false;
  $("#blockRazorpayModal").hidden = true;
});

$("#tabRazorpayModal")?.addEventListener("click", () => {
  $("#tabUpiDirect").className = "btn btn--ghost";
  $("#tabRazorpayModal").className = "btn btn--solid";
  $("#blockUpiDirect").hidden = true;
  $("#blockRazorpayModal").hidden = false;
});

$("#copyVpaBtn")?.addEventListener("click", () => {
  const vpa = $("#upiVpaText")?.textContent || "noirkart889658.rzp@rxairtel";
  navigator.clipboard.writeText(vpa).then(() => S.showToast("UPI VPA copied to clipboard!")).catch(() => S.showToast("Copied VPA: " + vpa));
});

$$(".upi-app-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const total = totals().total;
    const upiUri = `upi://pay?pa=noirkart889658.rzp@rxairtel&pn=NOIR%20Atelier&am=${total}&cu=INR&tn=NOIR%20Order`;
    window.location.href = upiUri;
  });
});

$("#payDirectUpiBtn")?.addEventListener("click", placeDirectUpiOrder);
$("#payStripeBtn").addEventListener("click", placeOrder);
$("#demoPayBtn").addEventListener("click", placeOrder);
$("#payRazorpayBtn").addEventListener("click", placeOrder);

/* Light formatting helpers for the demo card */
$("#demoCard").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^\d]/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
});
$("#demoExp").addEventListener("input", (e) => {
  let v = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
  if (v.length > 2) v = v.slice(0, 2) + " / " + v.slice(2);
  e.target.value = v;
});
$("#demoCvc").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
});

/* Live re-total if user edits cart elsewhere */
document.addEventListener("noir:cart", () => {
  updateCounters();
  renderSummary();
  renderDrawer();
});

/* ---------------- Drawer ---------------- */
const drawer = $("#drawer");
const drawerBackdrop = $("#drawerBackdrop");
function openDrawer() {
  drawer.classList.add("is-open");
  drawerBackdrop.classList.add("is-open");
  document.body.style.overflow = "hidden";
}
function closeDrawer() {
  drawer.classList.remove("is-open");
  drawerBackdrop.classList.remove("is-open");
  document.body.style.overflow = "";
}
$("#cartBtn").addEventListener("click", openDrawer);
$("#drawerClose").addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);

function updateCounters() {
  const c = S.cartCount();
  $("#cartCount").textContent = c;
  $("#cartCount").classList.toggle("has-items", c > 0);
  $("#drawerCount").textContent = c;
}

function renderDrawer() {
  const items = S.getCart();
  const body = $("#drawerBody");
  const foot = $("#drawerFoot");
  if (!items.length) {
    body.innerHTML = `<div class="drawer__empty"><p>Your bag is empty.</p></div>`;
    foot.style.display = "none";
    return;
  }
  foot.style.display = "";
  body.innerHTML = items
    .map(
      (i, idx) => `
      <div class="drawer__item">
        <img src="${esc(i.img)}" alt="${esc(i.name)}" />
        <div>
          <p class="drawer__item-name">${esc(i.name)}</p>
          <p class="drawer__item-meta">Size ${esc(i.size)}</p>
          <div class="drawer__qty">
            <button data-qmin="${idx}">−</button><span>${Number(i.qty) || 1}</span><button data-qplus="${idx}">+</button>
          </div>
        </div>
        <div class="drawer__item-side">
          <span class="drawer__item-price">${S.fmt((i.price || 0) * (i.qty || 1))}</span>
          <button class="drawer__remove" data-remove="${idx}">Remove</button>
        </div>
      </div>`
    )
    .join("");
  $("#subtotal").textContent = S.fmt(S.cartSubtotal());
  $("#shippingNote").textContent = S.cartSubtotal() >= (config.freeShipping || 120) ? "You've unlocked free shipping ✦" : `Free shipping over ${S.fmt(config.freeShipping || 120)}`;
  body.querySelectorAll("[data-qmin]").forEach((b) => b.addEventListener("click", () => S.setQty(+b.dataset.qmin, -1)));
  body.querySelectorAll("[data-qplus]").forEach((b) => b.addEventListener("click", () => S.setQty(+b.dataset.qplus, 1)));
  body.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => S.removeAt(+b.dataset.remove)));
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeDrawer();
    document.body.style.overflow = "";
  }
});

init();
