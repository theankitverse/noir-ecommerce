/* JSON-file product catalog.
   Seeded from products.js on first run, then editable at runtime.
   The admin API writes through to products.json. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTS as SEED } from "./products.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "products.json");

function load() {
  if (fs.existsSync(FILE)) {
    try {
      return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch {
      console.warn("[products] products.json was corrupt — reseeding from defaults.");
    }
  }
  fs.writeFileSync(FILE, JSON.stringify(SEED, null, 2));
  return SEED.map((p) => ({ ...p }));
}

let products = load();

function persist() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(products, null, 2));
  } catch (err) {
    /* Read-only filesystem (e.g. Vercel Serverless) — catalog state is maintained safely in-memory */
  }
}

const CATS = ["tops", "bottoms", "outerwear", "accessories"];

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalize(input) {
  const d = input || {};
  const price = num(d.price);
  const img = (d.img || "").trim();

  let colors = Array.isArray(d.colors) ? d.colors : [];
  if (typeof d.colors === "string" && d.colors.trim()) {
    colors = d.colors.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      const [name = "", hex = "#141312"] = s.split(":").map((x) => x.trim());
      return { name, hex };
    });
  }
  if (!colors.length) colors = [{ name: "Ink", hex: "#141312" }];

  let care = Array.isArray(d.care) ? d.care : [];
  if (typeof d.care === "string" && d.care.trim()) {
    care = d.care.split(",").map((s) => s.trim()).filter(Boolean);
  }

  let gallery = Array.isArray(d.gallery) ? d.gallery : [];
  if (typeof d.gallery === "string" && d.gallery.trim()) {
    gallery = d.gallery.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (!gallery.includes(img)) gallery.unshift(img);

  const defaultSizes = { S: 12, M: 15, L: 10, XL: 6 };
  let sizes = defaultSizes;
  if (d.sizes && typeof d.sizes === "object") {
    sizes = {
      S: num(d.sizes.S, 10),
      M: num(d.sizes.M, 15),
      L: num(d.sizes.L, 8),
      XL: num(d.sizes.XL, 5),
    };
  }

  const hasStock = Object.values(sizes).some((qty) => qty > 0);

  return {
    id: num(d.id),
    name: (d.name || "").trim(),
    cat: CATS.includes(d.cat) ? d.cat : "tops",
    price,
    compare: d.compare ? num(d.compare) : null,
    badge: ["new", "sale", ""].includes(d.badge) && d.badge ? d.badge : null,
    rating: Math.max(0, Math.min(5, num(d.rating, 4.5))),
    reviews: Math.max(0, Math.round(num(d.reviews, 0))),
    colors,
    fabric: (d.fabric || "100% natural fibres").trim(),
    care: care.length ? care : ["Machine wash cold", "Hang dry"],
    desc: (d.desc || "").trim(),
    img,
    hover: (d.hover || "").trim() || img,
    gallery,
    sizes,
    inStock: d.inStock !== false && hasStock,
  };
}

export function listProducts() {
  return products.map((p) => ({ ...p }));
}

export function getProduct(id) {
  const p = products.find((x) => x.id === Number(id));
  return p ? { ...p } : null;
}

export function addProduct(data) {
  const id = products.length ? Math.max(...products.map((p) => p.id)) + 1 : 1;
  const p = normalize({ id, ...data });
  products.push(p);
  persist();
  return { ...p };
}

export function updateProduct(id, data) {
  const i = products.findIndex((x) => x.id === Number(id));
  if (i === -1) return null;
  products[i] = normalize({ ...products[i], ...data, id: Number(id) });
  persist();
  return { ...products[i] };
}

export function deleteProduct(id) {
  const before = products.length;
  products = products.filter((x) => x.id !== Number(id));
  if (products.length === before) return false;
  persist();
  return true;
}
