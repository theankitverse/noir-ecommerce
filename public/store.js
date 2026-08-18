/* ==========================================================================
   NOIR — shared client store (cart, wishlist, helpers).
   Plain-script global so every page can use it.
   ========================================================================== */

window.Store = (function () {
  const CART_KEY = "noir_cart";
  const WISH_KEY = "noir_wishlist";
  const API = "/api";

  let cart = [];
  let wishlist = [];

  function readStored(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function persist(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  cart = readStored(CART_KEY, []);
  wishlist = readStored(WISH_KEY, []);

  /* Store currency config — refreshed from /api/config on load.
     Defaults already match the server so prices render correctly even
     before the fetch resolves. */
  let config = {
    gateway: "demo",
    demo: true,
    currency: "INR",
    symbol: "₹",
    freeShipping: 10200,
    shippingFee: 680,
  };

  const fmt = (n) => {
    const value = Number(n) || 0;
    const decimals = value % 1 === 0 ? 0 : 2;
    return config.symbol + value.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function emit(name) {
    document.dispatchEvent(new CustomEvent(name));
  }

  /* ----- Cart ----- */
  const getCart = () => cart.map((i) => ({ ...i }));

  function addToCart(item) {
    const line = cart.find((i) => i.id === item.id && i.size === item.size);
    if (line) line.qty = Math.min(10, line.qty + (item.qty || 1));
    else cart.push({ ...item, qty: item.qty || 1 });
    persist(CART_KEY, cart);
    emit("noir:cart");
    return cartCount();
  }

  function setQty(index, delta) {
    if (!cart[index]) return;
    cart[index].qty += delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    else cart[index].qty = Math.max(1, Math.min(10, cart[index].qty));
    persist(CART_KEY, cart);
    emit("noir:cart");
  }

  function removeAt(index) {
    cart.splice(index, 1);
    persist(CART_KEY, cart);
    emit("noir:cart");
  }

  function clearCart() {
    cart = [];
    persist(CART_KEY, cart);
    emit("noir:cart");
  }

  const cartCount = () => cart.reduce((n, i) => n + i.qty, 0);
  const cartSubtotal = () => cart.reduce((s, i) => s + i.qty * i.price, 0);

  /* ----- Wishlist ----- */
  const getWishlist = () => [...wishlist];
  const isWished = (id) => wishlist.includes(id);

  function toggleWish(id) {
    if (isWished(id)) wishlist = wishlist.filter((x) => x !== id);
    else wishlist.push(id);
    persist(WISH_KEY, wishlist);
    emit("noir:wish");
    return isWished(id);
  }

  function removeWish(id) {
    wishlist = wishlist.filter((x) => x !== id);
    persist(WISH_KEY, wishlist);
    emit("noir:wish");
  }

  const wishCount = () => wishlist.length;

  /* ----- API ----- */
  async function api(path, opts) {
    const res = await fetch(API + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  async function getConfig() {
    return api("/config");
  }

  /* ----- Toast ----- */
  let toastTimer;
  function showToast(msg) {
    const el = $("#toast");
    if (!el) return;
    $("#toastMsg").textContent = msg;
    el.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-show"), 2600);
  }

  /* ----- Image fallback (if Unsplash is slow/blocked) ----- */
  const PLACEHOLDER =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 800'>
        <rect width='600' height='800' fill='#eae6da'/>
        <circle cx='300' cy='360' r='120' fill='none' stroke='#141312' stroke-width='3'/>
        <text x='300' y='545' font-family='Georgia,serif' font-style='italic' font-size='34' fill='#d2542f' text-anchor='middle'>NOIR</text>
      </svg>`
    );

  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img && img.tagName === "IMG" && !img.dataset.err) {
        img.dataset.err = "1";
        img.src = PLACEHOLDER;
        img.style.background = "#eae6da";
      }
    },
    true
  );

  return {
    API, fmt, $, $$,
    config,
    getCart, addToCart, setQty, removeAt, clearCart, cartCount, cartSubtotal,
    getWishlist, isWished, toggleWish, removeWish, wishCount,
    api, getConfig, showToast,
  };
})();

/* Fire the config fetch as soon as the shared store boots. */
window.Store.getConfig().then((c) => {
  Object.assign(window.Store.config, c);
}).catch(() => {});
