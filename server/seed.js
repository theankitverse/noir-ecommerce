/* Reset the store to factory state: reseed the product catalog
   and wipe orders / newsletter data. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTS } from "./products.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.writeFileSync(
  path.join(__dirname, "products.json"),
  JSON.stringify(PRODUCTS, null, 2)
);
fs.writeFileSync(
  path.join(__dirname, "db.json"),
  JSON.stringify({ orders: [], seq: 1000, newsletter: [] }, null, 2)
);

console.log("✓ Seeded server/products.json (default catalog).");
console.log("✓ Reset server/db.json (orders & newsletter cleared).");
