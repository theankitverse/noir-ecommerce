/* ==========================================================================
   NOIR — product detail page (product.html)
   ========================================================================== */

const S = window.Store;
const SIZES = ["XS", "S", "M", "L", "XL"];

let product = null;
let related = [];
let qty = 1;
let size = "M";
let colorIdx = 0;

const CATS = { tops: "Tops", bottoms: "Bottoms", outerwear: "Outerwear", accessories: "Accessories" };

const $ = S.$;
const $$ = S.$$;

/* ---------------- Load ---------------- */
async function init() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) return fail("No product selected.");
  try {
    const [single, all] = await Promise.all([
      S.api(`/products/${id}`),
      S.api("/products"),
    ]);
    product = single;
    related = all.filter((p) => p.cat === product.cat && p.id !== product.id).slice(0, 4);
    if (related.length < 4) {
      related = related.concat(all.filter((p) => p.id !== product.id && !related.includes(p)).slice(0, 4 - related.length));
    }
    render();
  } catch (e) {
    fail(e.message);
  }
}

function fail(msg) {
  $("#productPage").innerHTML = `<div class="checkout__title" style="text-align:center;padding:8rem 1rem">${msg}<br/><a class="btn btn--solid" href="index.html#shop" style="margin-top:2rem">Back to shop</a></div>`;
}

/* ---------------- Render ---------------- */
function render() {
  document.title = `${product.name} — NOIR`;
  syncProductWishState();
  $("#crumbCat").textContent = CATS[product.cat];
  $("#pCat").textContent = `${CATS[product.cat]} / ${product.badge === "new" ? "New in" : "The Rituals Edit"}`;
  $("#pName").textContent = product.name;
  $("#pStars").textContent = "★".repeat(Math.round(product.rating));
  $("#pRatingMeta").textContent = `${product.rating.toFixed(1)} · ${product.reviews} reviews`;
  $("#pPrice").innerHTML = `${product.compare ? `<s>${S.fmt(product.compare)}</s>` : ""}${S.fmt(product.price)}`;
  $("#pDesc").textContent = product.desc;
  $("#pDetails").textContent = product.desc;
  $("#pFabric").textContent = product.fabric;
  $("#pCare").innerHTML = product.care.map((c) => `<li>${c}</li>`).join("");
  $("#stickyName").textContent = product.name;
  $("#stickyPrice").textContent = S.fmt(product.price);

  renderGallery();
  renderColors();
  renderSizes();
  renderRelated();
  fetchReviews();

  const badge = $("#galleryBadge");
  if (product.badge) {
    badge.hidden = false;
    badge.textContent = product.badge;
  }

  /* Out of stock — disable purchasing */
  const out = product.inStock === false;
  const addBtn = $("#addToCart");
  const stickyAddBtn = $("#stickyAdd");
  addBtn.disabled = out;
  stickyAddBtn.disabled = out;
  addBtn.textContent = out ? "Out of stock" : "Add to bag";
  stickyAddBtn.textContent = out ? "Out of stock" : "Add to bag";
  $("#pQty").style.pointerEvents = out ? "none" : "";
  $("#pQty").style.opacity = out ? "0.5" : "";

  /* sizes */
  size = "M";
}

function renderGallery() {
  const imgs = product.gallery || [product.img];
  $("#galleryMain").src = imgs[0];
  $("#galleryMain").alt = product.name;
  $("#galleryThumbs").innerHTML = imgs
    .map((src, i) => `<button class="gallery__thumb ${i === 0 ? "is-active" : ""}" data-img="${src}"><img src="${src}" alt="" loading="lazy" /></button>`)
    .join("");
  $$(".gallery__thumb").forEach((t) =>
    t.addEventListener("click", () => {
      $("#galleryMain").src = t.dataset.img;
      $$(".gallery__thumb").forEach((x) => x.classList.toggle("is-active", x === t));
    })
  );
}

function renderColors() {
  const wrap = $("#pColors");
  wrap.innerHTML = product.colors
    .map((c, i) => `<button class="color ${i === 0 ? "is-selected" : ""}" data-i="${i}" style="background:${c.hex}" aria-label="${c.name}"></button>`)
    .join("");
  colorIdx = 0;
  $$(".color", wrap).forEach((b) =>
    b.addEventListener("click", () => {
      colorIdx = +b.dataset.i;
      $$(".color", wrap).forEach((x) => x.classList.toggle("is-selected", x === b));
      $("#pColorName").textContent = product.colors[colorIdx].name;
    })
  );
  $("#pColorName").textContent = product.colors[0].name;
}

function renderSizes() {
  const wrap = $("#pSizes");
  wrap.innerHTML = SIZES.map((s) => `<button class="size ${s === "M" ? "is-selected" : ""}" data-size="${s}">${s}</button>`).join("");
  sizeMapEls();
}

function sizeMapEls() {
  $$(".size", $("#pSizes")).forEach((b) =>
    b.addEventListener("click", () => {
      size = b.dataset.size;
      $$(".size", $("#pSizes")).forEach((x) => x.classList.toggle("is-selected", x === b));
    })
  );
}

function renderRelated() {
  const wrap = $("#relatedGrid");
  wrap.innerHTML = related.length
    ? related.map((p, i) => cardHTML(p, i)).join("")
    : "<p>No related pieces yet.</p>";
  $$(".card__quick", wrap).forEach((b) =>
    b.addEventListener("click", () => (location.href = `product.html?id=${b.dataset.quick}`))
  );
  $$(".card__media", wrap).forEach((el) =>
    el.addEventListener("click", () => (location.href = `product.html?id=${el.dataset.product}`))
  );
  $$(".card__wish", wrap).forEach((b) =>
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const now = S.toggleWish(+b.dataset.wish);
      b.classList.toggle("is-wished", now);
      const icon = b.querySelector("svg");
      if (icon) icon.setAttribute("fill", now ? "currentColor" : "none");
      S.showToast(now ? "Saved to wishlist" : "Removed from wishlist");
    })
  );
}

function cardHTML(p, i) {
  const wished = S.isWished(p.id);
  return `
    <article class="card" style="animation-delay:${i * 60}ms">
      <div class="card__media" data-product="${p.id}">
        ${p.badge ? `<span class="card__badge ${p.badge === "new" ? "card__badge--new" : ""}">${p.badge}</span>` : ""}
        <button class="card__wish ${wished ? "is-wished" : ""}" data-wish="${p.id}" aria-label="Save">
          <svg viewBox="0 0 24 24" fill="${wished ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.6"><path d="M12 20.5S4 15 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5c0 5.5-8 11-8 11Z"/></svg>
        </button>
        <img class="img--main" src="${p.img}" alt="${p.name}" loading="lazy" />
        <img class="img--hover" src="${p.hover}" alt="" loading="lazy" aria-hidden="true" />
        <button class="card__quick" data-quick="${p.id}">Quick view</button>
      </div>
      <div class="card__info">
        <div>
          <h3 class="card__name"><a href="product.html?id=${p.id}">${p.name}</a></h3>
          <p class="card__cat">${CATS[p.cat]}</p>
        </div>
        <p class="card__price">${p.compare ? `<s>${S.fmt(p.compare)}</s>` : ""}${S.fmt(p.price)}</p>
      </div>
    </article>`;
}

/* ---------------- Interactions ---------------- */
$("#pQty").querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => {
    qty = Math.max(1, Math.min(10, qty + +b.dataset.q));
    $("#pQty span").textContent = qty;
  })
);

function addToBag() {
  if (!product || product.inStock === false) return;
  S.addToCart({ id: product.id, name: product.name, img: product.img, size, price: product.price, qty });
  updateCounters();
  S.showToast(`${product.name} added to bag`);
  openDrawer();
}

function syncProductWishState() {
  if (!product) return;
  const btn = $("#pWish");
  const now = S.isWished(product.id);
  btn.classList.toggle("is-wished", now);
  const icon = btn.querySelector("svg");
  if (icon) icon.setAttribute("fill", now ? "currentColor" : "none");
}

$("#addToCart").addEventListener("click", addToBag);
$("#stickyAdd").addEventListener("click", addToBag);

$("#pWish").addEventListener("click", () => {
  const now = S.toggleWish(product.id);
  syncProductWishState();
  S.showToast(now ? "Saved to wishlist" : "Removed from wishlist");
  updateCounters();
});

/* Accordion */
$$(".accordion__head").forEach((head) =>
  head.addEventListener("click", () => head.closest(".accordion__item").classList.toggle("is-open"))
);

/* Size guide modal */
const guideModal = $("#guideModal");
const guideBackdrop = $("#guideBackdrop");
$("#sizeGuideBtn").addEventListener("click", () => {
  guideModal.classList.add("is-open");
  guideBackdrop.classList.add("is-open");
});
$("#guideClose").addEventListener("click", closeGuide);
guideBackdrop.addEventListener("click", closeGuide);
function closeGuide() {
  guideModal.classList.remove("is-open");
  guideBackdrop.classList.remove("is-open");
}

/* Sticky bar visibility */
const stickyBar = $("#stickyBar");
const productInfo = document.querySelector(".product__info");
if (productInfo) {
  const io = new IntersectionObserver(
    ([en]) => stickyBar.classList.toggle("is-show", !en.isIntersecting),
    { threshold: 0.2 }
  );
  io.observe(productInfo);
}

/* ---------------- Shared page chrome ---------------- */
function updateCounters() {
  const c = S.cartCount();
  $("#cartCount").textContent = c;
  $("#cartCount").classList.toggle("has-items", c > 0);
  $("#wishCount").textContent = S.wishCount();
  $("#wishCount").classList.toggle("has-items", S.wishCount() > 0);
}

const drawer = $("#drawer");
const drawerBackdrop = $("#drawerBackdrop");
let locks = 0;
function lockScroll() {
  locks++;
  document.body.style.overflow = "hidden";
}
function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (locks === 0) document.body.style.overflow = "";
}
function openDrawer() {
  drawer.classList.add("is-open");
  drawerBackdrop.classList.add("is-open");
  lockScroll();
}
function closeDrawer() {
  drawer.classList.remove("is-open");
  drawerBackdrop.classList.remove("is-open");
  unlockScroll();
}
$("#cartBtn").addEventListener("click", openDrawer);
$("#drawerClose").addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);

document.addEventListener("noir:cart", () => { updateCounters(); renderDrawer(); });

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
        <img src="${i.img}" alt="${i.name}" />
        <div>
          <p class="drawer__item-name">${i.name}</p>
          <p class="drawer__item-meta">Size ${i.size}</p>
          <div class="drawer__qty">
            <button data-qmin="${idx}">−</button><span>${i.qty}</span><button data-qplus="${idx}">+</button>
          </div>
        </div>
        <div class="drawer__item-side">
          <span class="drawer__item-price">${S.fmt(i.price * i.qty)}</span>
          <button class="drawer__remove" data-remove="${idx}">Remove</button>
        </div>
      </div>`
    )
    .join("");
  $("#subtotal").textContent = S.fmt(S.cartSubtotal());
  const threshold = S.config.freeShipping;
  $("#shippingNote").textContent = S.cartSubtotal() >= threshold ? "You've unlocked free shipping ✦" : `Free shipping over ${S.fmt(threshold)}`;
  body.querySelectorAll("[data-qmin]").forEach((b) => b.addEventListener("click", () => S.setQty(+b.dataset.qmin, -1)));
  body.querySelectorAll("[data-qplus]").forEach((b) => b.addEventListener("click", () => S.setQty(+b.dataset.qplus, 1)));
  body.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => S.removeAt(+b.dataset.remove)));
}

/* Menu */
const menu = $("#menu");
const menuBtn = $("#menuBtn");
menuBtn.addEventListener("click", () => {
  const open = menu.classList.toggle("is-open");
  menuBtn.classList.toggle("is-open", open);
  menu.setAttribute("aria-hidden", String(!open));
  open ? lockScroll() : unlockScroll();
});
S.$$("a", menu).forEach((a) => a.addEventListener("click", () => {
  menu.classList.remove("is-open");
  menuBtn.classList.remove("is-open");
  unlockScroll();
}));

/* Header hide on scroll */
const header = $("#header");
let lastY = 0;
window.addEventListener("scroll", () => {
  const y = window.scrollY;
  header.style.transform = y > lastY && y > 320 ? "translateY(-110%)" : "translateY(0)";
  lastY = y;
}, { passive: true });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeDrawer();
    closeGuide();
    menu.classList.remove("is-open");
    menuBtn.classList.remove("is-open");
    unlockScroll();
  }
});

/* Search icon navigates to shop */
$("#searchBtn").addEventListener("click", () => (location.href = "index.html#shop"));

/* ---------------- Reviews ---------------- */
async function fetchReviews() {
  if (!product) return;
  try {
    const reviews = await S.api(`/products/${product.id}/reviews`);
    renderReviews(reviews);
  } catch (err) {
    console.error("Could not fetch reviews:", err);
  }
}

function renderReviews(reviews) {
  const container = $("#reviewsList");
  if (!container) return;
  if (!reviews || !reviews.length) {
    container.innerHTML = `<p style="color:var(--ink-soft);font-style:italic">No reviews yet for this piece. Be the first to share your thoughts!</p>`;
    return;
  }

  container.innerHTML = reviews
    .map(
      (r) => `
    <div style="padding:1.4rem 0;border-bottom:1px solid var(--line)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">
        <strong style="font-family:var(--font-display);font-size:1.05rem">${r.name} ${r.verified ? '<span style="font-size:0.68rem;letter-spacing:0.12em;background:var(--paper-2);padding:0.2rem 0.5rem;border-radius:4px;color:var(--ink-soft);font-family:var(--font-body)">VERIFIED BUYER</span>' : ''}</strong>
        <span style="color:var(--ember)">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
      </div>
      <p style="color:var(--ink-soft);font-size:0.95rem;line-height:1.6">${r.comment}</p>
      <span style="font-size:0.7rem;color:var(--ink-soft);opacity:0.7;display:block;margin-top:0.4rem">${new Date(r.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}</span>
    </div>`
    )
    .join("");
}

$("#writeReviewBtn")?.addEventListener("click", () => {
  $("#reviewFormCard").hidden = false;
});
$("#cancelReviewBtn")?.addEventListener("click", () => {
  $("#reviewFormCard").hidden = true;
});
$("#addReviewForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#revName").value.trim();
  const rating = Number($("#revRating").value);
  const comment = $("#revComment").value.trim();
  try {
    const res = await S.api(`/products/${product.id}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, rating, comment }),
    });
    if (res.ok) {
      S.showToast("Thank you for your review!");
      $("#addReviewForm").reset();
      $("#reviewFormCard").hidden = true;
      fetchReviews();
    }
  } catch (err) {
    S.showToast(err.message || "Could not submit review.");
  }
});

updateCounters();
renderDrawer();
init();
