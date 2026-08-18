/* ==========================================================================
   NOIR — order success page (success.html)
   ========================================================================== */

const S = window.Store;
const $ = S.$;
const esc = S.escapeHtml;

function statusPill(status) {
  const isPaid = status === "paid";
  return `<span class="status-pill ${isPaid ? "" : "pending"}">${isPaid ? "Paid ✓" : "Pending"}</span>`;
}

function render(order) {
  $("#sOrderId").textContent = order.id || "—";
  $("#sEmail").textContent = order.email || "—";
  $("#sStatus").innerHTML = statusPill(order.status);
  $("#sSubtotal").textContent = S.fmt(order.subtotal);
  $("#sShipping").textContent = order.shipping === 0 ? "Free" : S.fmt(order.shipping);
  $("#sTotal").textContent = S.fmt(order.total);

  $("#sItems").innerHTML = (order.items || [])
    .map(
      (i) => `
      <div class="success__item">
        <img src="${esc(i.img)}" alt="${esc(i.name)}" />
        <div>
          <p class="success__item-name">${esc(i.name)}</p>
          <p class="success__item-meta">Size ${esc(i.size)} · Qty ${Number(i.qty) || 1}</p>
        </div>
        <span class="success__item-price">${S.fmt((i.price || 0) * (i.qty || 1))}</span>
      </div>`
    )
    .join("");

  const a = order.address || {};
  $("#sAddress").innerHTML = `${esc(a.name || "")}<br/>${esc(a.line1 || "")}<br/>${esc(a.city || "")}, ${esc(a.zip || "")} · ${esc(a.country || "IN")}`;
}

async function init() {
  const params = new URLSearchParams(location.search);
  const orderId = params.get("order");
  const token = params.get("token");
  const sessionId = params.get("session_id");

  try {
    if (orderId) {
      const order = await S.api(`/order/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token || "")}`);
      render(order);
      S.clearCart();
      return;
    }
    if (sessionId) {
      /* Stripe: poll until the server confirms the payment went through. */
      for (let i = 0; i < 15; i++) {
        try {
          const order = await S.api(`/order/session/${encodeURIComponent(sessionId)}`);
          if (order && order.status === "paid") {
            render(order);
            S.clearCart();
            return;
          }
        } catch { /* keep polling */ }
        await new Promise((r) => setTimeout(r, 800));
      }
      /* Last resort — show the order anyway if available */
      try {
        const order = await S.api(`/order/session/${encodeURIComponent(sessionId)}`);
        if (order) { render(order); S.clearCart(); return; }
      } catch { /* ignore */ }
      $("#successSub").textContent = "Your payment succeeded — confirmation may take a moment. Check your email.";
      return;
    }
    $("#successSub").textContent = "No order found for this link.";
  } catch (e) {
    $("#successSub").textContent = e.message || "We couldn't load this order.";
  }
}

init();
