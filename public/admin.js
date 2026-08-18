/* ==========================================================================
   NOIR — admin panel (admin.html)
   ========================================================================== */

const S = window.Store;
const $ = S.$;
const $$ = S.$$;

let token = sessionStorage.getItem("noir_admin_token") || "";
let editingId = null;

const CATS = { tops: "Tops", bottoms: "Bottoms", outerwear: "Outerwear", accessories: "Accessories" };

function toast(msg, isErr) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("is-err", !!isErr);
  el.classList.add("is-show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("is-show"), 2600);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api/admin${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showLogin();
    throw new Error("Session expired — please sign in again.");
  }
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

/* ---------------- Auth ---------------- */
function showLogin() {
  sessionStorage.removeItem("noir_admin_token");
  token = "";
  $("#dashView").hidden = true;
  $("#loginView").style.display = "";
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginErr").textContent = "";
  try {
    const res = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("#loginPass").value }),
    });
    if (!res.ok) throw new Error("Wrong password.");
    token = $("#loginPass").value;
    sessionStorage.setItem("noir_admin_token", token);
    $("#loginView").style.display = "none";
    $("#dashView").hidden = false;
    $("#loginPass").value = "";
    boot();
  } catch (err) {
    $("#loginErr").textContent = err.message;
  }
});

$("#logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("noir_admin_token");
  showLogin();
});

/* ---------------- Tabs ---------------- */
$$(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    $$(".tabs button").forEach((x) => x.classList.toggle("is-active", x === b));
    $$("section[id^='tab-']").forEach((s) => (s.hidden = s.id !== `tab-${b.dataset.tab}`));
    if (b.dataset.tab === "products") loadProducts();
    if (b.dataset.tab === "orders") loadOrders();
    if (b.dataset.tab === "coupons") loadCoupons();
    if (b.dataset.tab === "newsletter") loadNewsletter();
  })
);

/* ---------------- Products ---------------- */
async function loadProducts() {
  const data = await api("/products");
  $("#prodCount").textContent = `· ${data.length}`;
  const wrap = $("#prodList");
  if (!data.length) {
    wrap.innerHTML = `<div class="empty">No products yet — add your first one.</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th></th><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th></th></tr></thead>
      <tbody>
        ${data.map((p) => `
          <tr>
            <td><img src="${p.img}" alt="" /></td>
            <td><strong>${p.name}</strong>${p.badge ? `<br/><span class="pill ${p.badge === "new" ? "new" : "paid"}">${p.badge}</span>` : ""}</td>
            <td>${CATS[p.cat] || p.cat}</td>
            <td>${p.compare ? `<s style="opacity:.5">${S.fmt(p.compare)}</s> ` : ""}${S.fmt(p.price)}</td>
            <td>${p.inStock ? "In stock" : `<span class="stock-out">Out of stock</span>`}</td>
            <td><div class="row-actions">
              <button class="mini-btn" data-edit="${p.id}">Edit</button>
              <button class="mini-btn danger" data-del="${p.id}">Delete</button>
            </div></td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  wrap.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditor(+b.dataset.edit, data)));
  wrap.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => removeProduct(+b.dataset.del)));
}

async function removeProduct(id) {
  if (!confirm("Delete this product permanently?")) return;
  try {
    await api(`/products/${id}`, { method: "DELETE" });
    toast("Product deleted.");
    loadProducts();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------- Product editor ---------------- */
function openEditor(id, all) {
  editingId = id;
  $("#pmTitle").textContent = "Edit product";
  const p = all.find((x) => x.id === id);
  if (!p) return;
  $("#fName").value = p.name;
  $("#fCat").value = p.cat;
  $("#fPrice").value = p.price;
  $("#fCompare").value = p.compare ?? "";
  $("#fBadge").value = p.badge || "";
  $("#fRating").value = p.rating;
  $("#fReviews").value = p.reviews;
  $("#fDesc").value = p.desc;
  $("#fImg").value = p.img;
  $("#fHover").value = p.hover && p.hover !== p.img ? p.hover : "";
  $("#fGallery").value = (p.gallery || []).join(", ");
  $("#fFabric").value = p.fabric;
  $("#fCare").value = (p.care || []).join(", ");
  $("#fColors").value = (p.colors || []).map((c) => `${c.name}:${c.hex}`).join(", ");
  $("#fStock").checked = p.inStock !== false;
  $("#productModal").classList.add("is-open");
}

function newProduct() {
  editingId = null;
  $("#pmTitle").textContent = "Add product";
  $("#productForm").reset();
  $("#fCat").value = "tops";
  $("#fRating").value = "4.5";
  $("#fStock").checked = true;
  $("#productModal").classList.add("is-open");
}

$("#addProductBtn").addEventListener("click", newProduct);
$("#pmCancel").addEventListener("click", () => $("#productModal").classList.remove("is-open"));
$("#productModal").addEventListener("click", (e) => { if (e.target === $("#productModal")) $("#productModal").classList.remove("is-open"); });

$("#productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    name: $("#fName").value.trim(),
    cat: $("#fCat").value,
    price: Number($("#fPrice").value),
    compare: $("#fCompare").value ? Number($("#fCompare").value) : null,
    badge: $("#fBadge").value || null,
    rating: Number($("#fRating").value),
    reviews: Number($("#fReviews").value),
    desc: $("#fDesc").value.trim(),
    img: $("#fImg").value.trim(),
    hover: $("#fHover").value.trim() || null,
    gallery: $("#fGallery").value.split(",").map((s) => s.trim()).filter(Boolean),
    fabric: $("#fFabric").value.trim(),
    care: $("#fCare").value.split(",").map((s) => s.trim()).filter(Boolean),
    colors: $("#fColors").value.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      const [name, hex] = s.split(":").map((x) => x.trim());
      return { name: name || "Ink", hex: hex || "#141312" };
    }),
    inStock: $("#fStock").checked,
  };
  if (!payload.img) return toast("An image URL is required.", true);
  try {
    if (editingId) {
      await api(`/products/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Product updated.");
    } else {
      await api("/products", { method: "POST", body: JSON.stringify(payload) });
      toast("Product added.");
    }
    $("#productModal").classList.remove("is-open");
    loadProducts();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------------- Orders ---------------- */
async function loadOrders() {
  const data = await api("/orders");
  const wrap = $("#orderList");
  if (!data.length) {
    wrap.innerHTML = `<div class="empty">No orders yet. They'll appear here as customers check out.</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status &amp; Tracking</th></tr></thead>
      <tbody>
        ${data.map((o) => `
          <tr>
            <td><strong>${o.id}</strong><br/><span class="order-items">${new Date(o.createdAt).toLocaleString()}</span></td>
            <td>${o.address?.name || "—"}<br/><span class="order-items">${o.email}</span><br/><span class="order-items">${o.address?.city || ""}, ${o.address?.country || ""}</span></td>
            <td><span class="order-items">${o.items.map((i) => `${i.qty}× ${i.name} (${i.size})`).join("<br/>")}</span></td>
            <td class="order-total">${S.fmt(o.total)}</td>
            <td>
              <div style="display:grid;gap:0.4rem">
                <select class="status-select" data-order="${o.id}">
                  ${["pending","paid","shipped","delivered","cancelled","refunded"].map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
                </select>
                <button class="mini-btn" data-ship="${o.id}">Update Tracking</button>
                ${o.trackingNumber ? `<span style="font-size:0.7rem;color:var(--ink-soft)">${o.carrier || 'BlueDart'}: ${o.trackingNumber}</span>` : ""}
              </div>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  wrap.querySelectorAll(".status-select").forEach((sel) =>
    sel.addEventListener("change", async () => {
      try {
        const updated = await api(`/orders/${sel.dataset.order}`, {
          method: "PATCH",
          body: JSON.stringify({ status: sel.value }),
        });
        toast(`Order ${updated.id} → ${updated.status}`);
        loadOrders();
      } catch (e) {
        toast(e.message, true);
        loadOrders();
      }
    })
  );
  wrap.querySelectorAll("[data-ship]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const orderId = btn.dataset.ship;
      const carrier = prompt("Courier Carrier Name:", "BlueDart Express") || "BlueDart Express";
      const trackingNumber = prompt("Tracking Number / AWB:");
      if (!trackingNumber) return;
      try {
        await api(`/orders/${orderId}/ship`, {
          method: "POST",
          body: JSON.stringify({ carrier, trackingNumber, trackingUrl: `https://www.bluedart.com/tracking` }),
        });
        toast(`Order ${orderId} updated with tracking: ${trackingNumber}`);
        loadOrders();
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
}

/* ---------------- Coupons ---------------- */
async function loadCoupons() {
  const data = await api("/coupons");
  const wrap = $("#couponList");
  if (!data.length) {
    wrap.innerHTML = `<div class="empty">No active coupons. Create your first promo code.</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Min Spend</th><th>Description</th><th>Action</th></tr></thead>
      <tbody>
        ${data.map((c) => `
          <tr>
            <td><strong>${c.code}</strong></td>
            <td>${c.type}</td>
            <td>${c.type === "percent" ? `${c.value}% OFF` : c.type === "fixed" ? S.fmt(c.value) : "Free Shipping"}</td>
            <td>${c.minSpend ? S.fmt(c.minSpend) : "No min"}</td>
            <td>${c.desc || "—"}</td>
            <td><button class="mini-btn danger" data-del-coupon="${c.code}">Delete</button></td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  wrap.querySelectorAll("[data-del-coupon]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete coupon code ${btn.dataset.delCoupon}?`)) return;
      try {
        await api(`/coupons/${btn.dataset.delCoupon}`, { method: "DELETE" });
        toast("Coupon deleted.");
        loadCoupons();
      } catch (err) {
        toast(err.message, true);
      }
    })
  );
}

$("#addCouponBtn")?.addEventListener("click", async () => {
  const code = prompt("Enter new Coupon Code (e.g. NOIR10):");
  if (!code) return;
  const valueStr = prompt("Discount Percentage or Amount (e.g. 10):", "10");
  if (!valueStr) return;
  try {
    await api("/coupons", {
      method: "POST",
      body: JSON.stringify({ code: code.toUpperCase(), type: "percent", value: Number(valueStr), desc: `${valueStr}% discount` }),
    });
    toast(`Coupon ${code.toUpperCase()} created!`);
    loadCoupons();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------------- Newsletter ---------------- */
async function loadNewsletter() {
  const data = await api("/newsletter");
  const wrap = $("#newsList");
  if (!data.length) {
    wrap.innerHTML = `<div class="empty">No subscribers yet.</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>Email</th></tr></thead>
      <tbody>${data.map((em, i) => `<tr><td>${i + 1}</td><td>${em}</td></tr>`).join("")}</tbody>
    </table>`;
}

$("#exportCsvBtn")?.addEventListener("click", () => {
  window.open(`/api/admin/newsletter/export?token=${encodeURIComponent(token)}`, "_blank");
});

/* ---------------- Boot ---------------- */
async function boot() {
  try {
    $("#dashView").hidden = false;
    await Promise.all([loadProducts(), loadOrders(), loadNewsletter()]);
  } catch (e) {
    showLogin();
  }
}

if (token) {
  $("#loginView").style.display = "none";
  boot().catch(() => showLogin());
}
