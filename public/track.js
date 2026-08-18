/* Order Tracking Client Logic */
const S = window.Store;
const $ = S.$;

async function fetchOrderTrack(id, email) {
  const errEl = $("#trackErr");
  const resEl = $("#trackResult");
  const btn = $("#trackBtn");

  errEl.hidden = true;
  resEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Locating…";

  try {
    const params = new URLSearchParams({ id, email });
    const order = await S.api(`/order/track?${params.toString()}`);

    renderTrackingOrder(order);
    resEl.hidden = false;
  } catch (err) {
    errEl.textContent = err.message || "Order not found. Check your credentials.";
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Track Order";
  }
}

function renderTrackingOrder(order) {
  $("#resOrderTitle").textContent = `Order #${order.id}`;
  const d = new Date(order.createdAt);
  $("#resOrderDate").textContent = `Placed on ${d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}`;

  const status = (order.status || "pending").toLowerCase();
  $("#resBadge").textContent = status.toUpperCase();
  $("#resBadge").className = `card__badge ${status === "paid" || status === "delivered" ? "card__badge--new" : ""}`;

  // Update Timeline steps
  const steps = ["Placed", "Paid", "Shipped", "Delivered"];
  const isPaid = ["paid", "shipped", "delivered"].includes(status);
  const isShipped = ["shipped", "delivered"].includes(status);
  const isDelivered = status === "delivered";

  setStepState("#stepPlaced", true, !isPaid, d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
  setStepState("#stepPaid", isPaid, isPaid && !isShipped, order.paidAt ? new Date(order.paidAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "Pending");
  setStepState("#stepShipped", isShipped, isShipped && !isDelivered, order.shippedAt ? new Date(order.shippedAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" }) : "In Atelier");
  setStepState("#stepDelivered", isDelivered, isDelivered, isDelivered ? "Delivered" : "Pending");

  // Carrier info
  $("#resCarrier").innerHTML = `<strong>Carrier:</strong> ${order.carrier || "BlueDart Express / Express Post"}`;
  if (order.trackingNumber) {
    $("#trackNumVal").innerHTML = `<a href="${order.trackingUrl || '#'}" target="_blank" style="text-decoration:underline;color:var(--ember)">${order.trackingNumber} ↗</a>`;
  } else {
    $("#trackNumVal").textContent = "Preparing for dispatch";
  }

  // Address
  const addr = order.address || {};
  $("#addrVal").textContent = `${addr.name || ""}, ${addr.line1 || ""}, ${addr.city || ""} ${addr.zip || ""}, ${addr.country || "IN"}`;

  // Items
  $("#resItemList").innerHTML = (order.items || [])
    .map(
      (item) => `
      <div class="order-item-row">
        <div>
          <strong>${item.name}</strong> <span style="color:var(--ink-soft)">(Size ${item.size || "M"}) × ${item.qty || 1}</span>
        </div>
        <div>${S.fmt((item.price || 0) * (item.qty || 1))}</div>
      </div>`
    )
    .join("");

  $("#resTotalPaid").textContent = S.fmt(order.total || 0);
}

function setStepState(selector, isDone, isCurrent, timeText) {
  const el = $(selector);
  if (!el) return;
  el.classList.toggle("is-done", isDone);
  el.classList.toggle("is-current", isCurrent);
  const p = el.querySelector("p");
  if (p) p.textContent = timeText;
}

$("#trackForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("#trackId").value.trim();
  const email = $("#trackEmail").value.trim();
  fetchOrderTrack(id, email);
});

// Auto track if query params present
const urlParams = new URLSearchParams(location.search);
if (urlParams.get("id") && urlParams.get("email")) {
  $("#trackId").value = urlParams.get("id");
  $("#trackEmail").value = urlParams.get("email");
  fetchOrderTrack(urlParams.get("id"), urlParams.get("email"));
}
