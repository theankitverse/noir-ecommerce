/* ==========================================================================
   NOIR — home page (index.html)
   ========================================================================== */

const S = window.Store;
const $ = S.$;
const $$ = S.$$;
const esc = S.escapeHtml;
const CATS = {
  tops: "Tops",
  bottoms: "Bottoms",
  outerwear: "Outerwear",
  accessories: "Accessories",
};
const SIZES = ["XS", "S", "M", "L", "XL"];

let products = [];
let activeFilter = "all";
let activeSort = "featured";
let searchQuery = "";

const grid = $("#grid");
const gridEmpty = $("#gridEmpty");

/* ---------------- Fetch products ---------------- */
async function loadProducts() {
  grid.innerHTML = Array(6).fill('<div class="grid__skeleton"></div>').join("");
  try {
    products = await S.api("/products");
    renderGrid();
    renderWishDrawer();
  } catch (e) {
    grid.innerHTML = `<p class="grid__empty">${esc(e.message)}</p>`;
  }
}

function filtered() {
  return products.filter((p) => {
    const catOk = activeFilter === "all" || p.cat === activeFilter;
    const qOk = !searchQuery || p.name.toLowerCase().includes(searchQuery);
    return catOk && qOk;
  });
}

function applySort(list) {
  const l = [...list];
  if (activeSort === "price-asc") l.sort((a, b) => a.price - b.price);
  else if (activeSort === "price-desc") l.sort((a, b) => b.price - a.price);
  else if (activeSort === "new") l.sort((a, b) => (b.badge === "new") - (a.badge === "new"));
  return l;
}

function cardHTML(p, i) {
  const wished = S.isWished(p.id);
  return `
    <article class="card" data-id="${p.id}" style="animation-delay:${Math.min(i, 8) * 60}ms">
      <div class="card__media">
        ${p.badge ? `<span class="card__badge ${p.badge === "new" ? "card__badge--new" : ""}">${esc(p.badge)}</span>` : ""}
        <button class="card__wish ${wished ? "is-wished" : ""}" data-wish="${p.id}" aria-label="Save to wishlist">
          <svg viewBox="0 0 24 24" fill="${wished ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.6"><path d="M12 20.5S4 15 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5c0 5.5-8 11-8 11Z"/></svg>
        </button>
        <img class="img--main" src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy" />
        <img class="img--hover" src="${esc(p.hover)}" alt="" loading="lazy" aria-hidden="true" />
        <button class="card__quick" data-quick="${p.id}">Quick view</button>
      </div>
      <div class="card__info">
        <div>
          <h3 class="card__name"><a href="product.html?id=${p.id}">${esc(p.name)}</a></h3>
          <p class="card__cat">${esc(CATS[p.cat] || p.cat)} · <span class="stars" style="font-size:.72rem">${stars(p.rating)}</span></p>
        </div>
        <p class="card__price">${p.compare ? `<s>${S.fmt(p.compare)}</s>` : ""}${S.fmt(p.price)}</p>
      </div>
    </article>`;
}

function stars(r) {
  return "★".repeat(Math.round(r));
}

function renderGrid() {
  const list = applySort(filtered());
  gridEmpty.hidden = list.length > 0;
  grid.innerHTML = list.map(cardHTML).join("") || "";
  bindGrid();
}

function bindGrid() {
  $$(".card", grid).forEach((card) => {
    const id = +card.dataset.id;
    card.querySelector(".card__quick").addEventListener("click", () => openModal(id));
    card.querySelector(".card__wish").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleWishUI(id, card.querySelector(".card__wish"));
    });
  });
}

/* ---------------- Wishlist UI ---------------- */
function toggleWishUI(id, el) {
  const nowWished = S.toggleWish(id);
  if (el) {
    el.classList.toggle("is-wished", nowWished);
    el.querySelector("svg").setAttribute("fill", nowWished ? "currentColor" : "none");
  }
  renderWishDrawer();
  S.showToast(nowWished ? "Saved to wishlist" : "Removed from wishlist");
}

/* ---------------- Filters / sort / search ---------------- */
$("#filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  activeFilter = chip.dataset.filter;
  $$(".chip", $("#filters")).forEach((c) => c.classList.toggle("is-active", c === chip));
  renderGrid();
});

$("#sortSelect").addEventListener("change", (e) => {
  activeSort = e.target.value;
  renderGrid();
});

const searchEl = $("#search");
const searchInput = $("#searchInput");
$("#searchBtn").addEventListener("click", () => {
  searchEl.classList.add("is-open");
  searchInput.focus();
});
function closeSearch() {
  searchEl.classList.remove("is-open");
  if (searchQuery) {
    searchQuery = "";
    searchInput.value = "";
    renderGrid();
  }
}
$("#searchClose").addEventListener("click", closeSearch);
searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderGrid();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSearch();
    closeDrawer();
    closeWishDrawer();
    closeModal();
    closeMenu();
  }
});

/* ---------------- Header / cart / drawer ---------------- */
const cartBtn = $("#cartBtn");
const drawer = $("#drawer");
const drawerBackdrop = $("#drawerBackdrop");
const wishDrawer = $("#wishDrawer");
const wishBackdrop = $("#wishBackdrop");

/* Keep scroll locked while any overlay is open; unlock only when all close. */
let locks = 0;
function lockScroll() {
  locks++;
  document.body.style.overflow = "hidden";
}
function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (locks === 0) document.body.style.overflow = "";
}

function updateCounters() {
  const c = S.cartCount();
  const w = S.wishCount();
  $("#cartCount").textContent = c;
  $("#cartCount").classList.toggle("has-items", c > 0);
  $("#wishCount").textContent = w;
  $("#wishCount").classList.toggle("has-items", w > 0);
  $("#drawerCount").textContent = c;
  $("#wishDrawerCount").textContent = w;
}

function bumpCart() {
  $("#cartCount").classList.remove("bump");
  void $("#cartCount").offsetWidth;
  $("#cartCount").classList.add("bump");
}

document.addEventListener("noir:cart", () => {
  updateCounters();
  renderDrawer();
});
document.addEventListener("noir:wish", () => {
  updateCounters();
  renderWishDrawer();
  grid.querySelectorAll(".card__wish").forEach((el) => {
    const id = +el.dataset.wish;
    const now = S.isWished(id);
    el.classList.toggle("is-wished", now);
    el.querySelector("svg").setAttribute("fill", now ? "currentColor" : "none");
  });
});

function openDrawer() {
  drawer.classList.add("is-open");
  drawerBackdrop.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  lockScroll();
}
function closeDrawer() {
  drawer.classList.remove("is-open");
  drawerBackdrop.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  unlockScroll();
}
cartBtn.addEventListener("click", openDrawer);
$("#drawerClose").addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);
$("#keepShopping").addEventListener("click", closeDrawer);

function renderDrawer() {
  const body = $("#drawerBody");
  const foot = $("#drawerFoot");
  const items = S.getCart();

  if (!items.length) {
    body.innerHTML = `
      <div class="drawer__empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
        <p>Your bag is empty.</p>
        <p style="margin-top:.4rem;font-size:.85rem">Start with something timeless.</p>
      </div>`;
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
            <button data-qmin="${idx}" aria-label="Decrease">−</button>
            <span>${i.qty}</span>
            <button data-qplus="${idx}" aria-label="Increase">+</button>
          </div>
        </div>
        <div class="drawer__item-side">
          <span class="drawer__item-price">${S.fmt(i.price * i.qty)}</span>
          <button class="drawer__remove" data-remove="${idx}">Remove</button>
        </div>
      </div>`
    )
    .join("");

  const sub = S.cartSubtotal();
  const threshold = S.config.freeShipping;
  $("#subtotal").textContent = S.fmt(sub);
  const note = $("#shippingNote");
  if (sub >= threshold) {
    note.textContent = "You've unlocked free shipping ✦";
    note.classList.add("is-free");
  } else {
    note.textContent = `Add ${S.fmt(threshold - sub)} for free shipping`;
    note.classList.remove("is-free");
  }

  body.querySelectorAll("[data-qmin]").forEach((b) => b.addEventListener("click", () => S.setQty(+b.dataset.qmin, -1)));
  body.querySelectorAll("[data-qplus]").forEach((b) => b.addEventListener("click", () => S.setQty(+b.dataset.qplus, 1)));
  body.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => S.removeAt(+b.dataset.remove)));
}

/* Wishlist drawer */
function openWishDrawer() {
  wishDrawer.classList.add("is-open");
  wishBackdrop.classList.add("is-open");
  wishDrawer.setAttribute("aria-hidden", "false");
  lockScroll();
}
function closeWishDrawer() {
  wishDrawer.classList.remove("is-open");
  wishBackdrop.classList.remove("is-open");
  wishDrawer.setAttribute("aria-hidden", "true");
  unlockScroll();
}
$("#wishBtn").addEventListener("click", openWishDrawer);
$("#wishDrawerClose").addEventListener("click", closeWishDrawer);
wishBackdrop.addEventListener("click", closeWishDrawer);

function renderWishDrawer() {
  const body = $("#wishBody");
  const ids = S.getWishlist();
  const items = products.filter((p) => ids.includes(p.id));

  if (!items.length) {
    body.innerHTML = `
      <div class="drawer__empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M12 20.5S4 15 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5c0 5.5-8 11-8 11Z"/></svg>
        <p>Nothing saved yet.</p>
        <p style="margin-top:.4rem;font-size:.85rem">Tap the ♥ on anything you love.</p>
      </div>`;
    return;
  }

  body.innerHTML = items
    .map(
      (p) => `
      <div class="wish-item">
        <img src="${p.img}" alt="${p.name}" />
        <div>
          <p class="wish-item__name"><a href="product.html?id=${p.id}">${p.name}</a></p>
          <p class="wish-item__price">${S.fmt(p.price)}</p>
        </div>
        <div class="wish-item__side">
          <button class="wish-item__add" data-wadd="${p.id}">Add to bag</button>
          <button class="wish-item__remove" data-wrem="${p.id}">Remove</button>
        </div>
      </div>`
    )
    .join("");

  body.querySelectorAll("[data-wadd]").forEach((b) => {
    b.addEventListener("click", () => {
      const p = products.find((x) => x.id === +b.dataset.wadd);
      S.addToCart({ id: p.id, name: p.name, img: p.img, size: "M", price: p.price });
      bumpCart();
      S.showToast(`${p.name} added to bag`);
    });
  });
  body.querySelectorAll("[data-wrem]").forEach((b) =>
    b.addEventListener("click", () => S.removeWish(+b.dataset.wrem))
  );
}

/* ---------------- Quick view modal ---------------- */
const modal = $("#modal");
const modalBackdrop = $("#modalBackdrop");

function openModal(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  modalQty = 1;
  const wished = S.isWished(id);
  const inner = $("#modalInner");
  inner.innerHTML = `
    <div class="modal__media">
      <img src="${esc(p.img)}" alt="${esc(p.name)}" />
    </div>
    <div class="modal__info">
      <span class="modal__cat">${esc(CATS[p.cat] || p.cat)} / ${p.badge === "new" ? "New in" : "The Rituals Edit"}</span>
      <h3 class="modal__name"><a href="product.html?id=${p.id}">${esc(p.name)}</a></h3>
      <p class="modal__price">${p.compare ? `<s>${S.fmt(p.compare)}</s>` : ""}${S.fmt(p.price)}</p>
      <p class="modal__desc">${esc(p.desc)}</p>
      <span class="modal__label">Size</span>
      <div class="sizes" id="quickSizes">
        ${SIZES.map((s) => `<button class="size ${s === "M" ? "is-selected" : ""}" data-size="${s}">${s}</button>`).join("")}
      </div>
      <div class="modal__qty-row">
        <span class="modal__label" style="margin:0">Qty</span>
        <div class="qty" id="quickQty">
          <button data-q="-1">−</button><span>1</span><button data-q="1">+</button>
        </div>
        <button class="card__wish ${wished ? "is-wished" : ""}" data-quickwish="${id}" aria-label="Wishlist"
          style="position:static">
          <svg viewBox="0 0 24 24" fill="${wished ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.6"><path d="M12 20.5S4 15 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5c0 5.5-8 11-8 11Z"/></svg>
        </button>
      </div>
      <button class="btn btn--solid modal__add" data-add="${p.id}">Add to bag — ${S.fmt(p.price)}</button>
      <div class="modal__meta">
        ✦ Free shipping over ₹10,200<br />
        ✦ Free 30-day returns<br />
        ✦ Made from natural fibres
      </div>
    </div>`;

  let size = "M";
  let qty = 1;
  inner.querySelectorAll(".size").forEach((b) =>
    b.addEventListener("click", () => {
      size = b.dataset.size;
      inner.querySelectorAll(".size").forEach((s) => s.classList.toggle("is-selected", s === b));
    })
  );
  const qEl = inner.querySelector("#quickQty span");
  inner.querySelectorAll("#quickQty button").forEach((b) => {
    b.addEventListener("click", () => {
      qty = Math.max(1, Math.min(10, qty + +b.dataset.q));
      qEl.textContent = qty;
    });
  });
  inner.querySelector("[data-add]").addEventListener("click", () => {
    S.addToCart({ id: p.id, name: p.name, img: p.img, size, price: p.price, qty });
    bumpCart();
    closeModal();
    openDrawer();
    S.showToast(`${p.name} added to bag`);
  });
  inner.querySelector("[data-quickwish]").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const now = S.toggleWish(id);
    btn.classList.toggle("is-wished", now);
    btn.querySelector("svg").setAttribute("fill", now ? "currentColor" : "none");
    renderWishDrawer();
  });

  modal.classList.add("is-open");
  modalBackdrop.classList.add("is-open");
  lockScroll();
}

function closeModal() {
  modal.classList.remove("is-open");
  modalBackdrop.classList.remove("is-open");
  unlockScroll();
}
$("#modalClose").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);

/* ---------------- Menu ---------------- */
const menu = $("#menu");
const menuBtn = $("#menuBtn");
function openMenu() {
  menu.classList.add("is-open");
  menuBtn.classList.add("is-open");
  menu.setAttribute("aria-hidden", "false");
  lockScroll();
}
function closeMenu() {
  menu.classList.remove("is-open");
  menuBtn.classList.remove("is-open");
  menu.setAttribute("aria-hidden", "true");
  unlockScroll();
}
menuBtn.addEventListener("click", () => (menu.classList.contains("is-open") ? closeMenu() : openMenu()));
S.$$("a", menu).forEach((a) => a.addEventListener("click", closeMenu));

/* ---------------- Header scroll, to-top, hero parallax ---------------- */
const header = $("#header");
const toTop = $("#toTop");
let lastY = 0;
window.addEventListener("scroll", () => {
  const y = window.scrollY;
  header.style.transform = y > lastY && y > 320 ? "translateY(-110%)" : "translateY(0)";
  toTop.classList.toggle("is-show", y > 700);
  lastY = y;
}, { passive: true });
toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

const heroMedia = $("#heroMedia");
if (heroMedia && window.matchMedia("(pointer: fine)").matches) {
  const hero = document.querySelector(".hero");
  hero.addEventListener("mousemove", (e) => {
    const r = hero.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    heroMedia.style.transform = `translate(${x * 14}px, ${y * 14}px)`;
  });
  hero.addEventListener("mouseleave", () => (heroMedia.style.transform = "translate(0, 0)"));
}

/* ---------------- Newsletter ---------------- */
$("#newsletterForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = e.target.querySelector("input[type=email]");
  try {
    const res = await S.api("/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: input.value }),
    });
    S.showToast(res.already ? "You're already on the list ✦" : "Welcome to the inner circle. Check your inbox ✦");
    e.target.reset();
  } catch (err) {
    S.showToast(err.message);
  }
});

/* ---------------- Reveal ---------------- */
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } }),
    { threshold: 0.15 }
  );
  S.$$(".reveal").forEach((el) => io.observe(el));
} else {
  S.$$(".reveal").forEach((el) => el.classList.add("is-in"));
}

/* ---------------- Loader ---------------- */
let booted = false;
function finishLoad() {
  if (booted) return;
  booted = true;
  document.body.classList.add("is-loaded");
  $("#loader").classList.add("is-done");
}
/* Safety net: never trap the user behind the loader, even if
   remote images/fonts are slow or blocked. */
window.addEventListener("load", finishLoad);
setTimeout(finishLoad, 1400);

/* ---------------- Init ---------------- */
loadProducts();
updateCounters();
renderDrawer();
renderWishDrawer();
if (new URLSearchParams(location.search).get("wish") === "1") {
  window.addEventListener("load", () => setTimeout(openWishDrawer, 350));
}
