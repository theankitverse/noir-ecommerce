/* ==========================================================================
   NOIR — order success page (success.html)
   ========================================================================== */

const S = window.Store;
const $ = S.$;

function statusPill(status) {
  return `<span class="status-pill ${status === "pending" ? "pending" : ""}">${status === "paid" ? "Paid ✓" : "Pending"}</span>`;
}

function render(order) {
  $("#sOrderId").textContent = order.id;
  $("#sEmail").textContent = order.email;
  $("#sStatus").innerHTML = statusPill(order.status);
  $("#sSubtotal").textContent = S.fmt(order.subtotal);
  $("#sShipping").textContent = order.shipping === 0 ? "Free" : S.fmt(order.shipping);
  $("#sTotal").textContent = S.fmt(order.total);

  $("#sItems").innerHTML = order.items
    .map(
      (i) => `
      <div class="success__item">
        <img src="${i.img}" alt="${i.name}" />
        <div>
          <p class="success__item-name">${i.name}</p>
          <p class="success__item-meta">Size ${i.size} · Qty ${i.qty}</p>
        </div>
        <span class="success__item-price">${S.fmt(i.price * i.qty)}</span>
      </div>`
    )
    .join("");

  const a = order.address;
  $("#sAddress").innerHTML = `${a.name}<br/>${a.line1}<br/>${a.city}, ${a.zip} · ${a.country}`;
}

async function init() {
  const params = new URLSearchParams(location.search);
  const orderId = params.get("order");
  const sessionId = params.get("session_id");

  try {
    if (orderId) {
      const order = await S.api(`/order/${orderId}`);
      render(order);
      return;
    }
    if (sessionId) {
      /* Stripe: poll until the server confirms the payment went through. */
      for (let i = 0; i < 15; i++) {
        try {
          const order = await S.api(`/order/session/${sessionId}`);
          if (order && order.status === "paid") {
            render(order);
            S.clearCart();
            return;
          }
        } catch { /* keep polling */ }
        await new Promise((r) => setTimeout(r, 800));
      }
      /* Last resort — show the order anyway, it may still be confirming. */
      try {
        const order = await S.api(`/order/session/${sessionId}`);
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
