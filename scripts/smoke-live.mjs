// Smoke test live terhadap API yang berjalan (bukan mock).
// Jalankan: node scripts/smoke-live.mjs
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const OUTLET = "outlet-rumbai";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -> ${detail}` : ""}`);
}

async function call(path, { method = "GET", token, body, raw = false } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: response.status, headers: response.headers, text: await response.text() };
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

async function login(email, password) {
  const { status, json } = await call("/api/v1/auth/login", {
    method: "POST",
    body: { email, password, deviceName: "smoke" },
  });
  if (status !== 200) return { ok: false, detail: `HTTP ${status} ${json?.error?.code ?? ""}` };
  return { ok: true, token: json.data.accessToken, role: json.data.user.memberships[0]?.role };
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

async function main() {
  const health = await call("/health/ready");
  record("health/ready", health.status === 200 && health.json?.data?.db === "connected", `db=${health.json?.data?.db}`);

  const crew = await login("crew.rumbai@seroo.local", "PasswordCrew123!");
  record("login CREW", crew.ok, crew.detail || crew.role);
  const manager = await login("manager.rumbai@seroo.local", "PasswordManager123!");
  record("login MANAGER", manager.ok, manager.detail || manager.role);
  const owner = await login("owner@seroo.local", "PasswordOwner123!");
  record("login OWNER_MITRA", owner.ok, owner.detail || owner.role);
  const admin = await login("admin@seroo.local", "PasswordAdmin123!");
  record("login ADMIN_PUSAT", admin.ok, admin.detail || admin.role);

  if (!crew.ok || !manager.ok || !owner.ok || !admin.ok) return;

  const me = await call("/api/v1/auth/me", { token: crew.token });
  record("auth/me", me.status === 200 && Boolean(me.json?.data?.user?.id));

  const catalog = await call(`/api/v1/outlets/${OUTLET}/catalog`, { token: crew.token });
  const variants = (catalog.json?.data?.products ?? []).flatMap((p) => p.variants);
  record("katalog crew", catalog.status === 200 && variants.length > 0, `${variants.length} varian`);
  if (variants.length === 0) return;
  const variantA = variants[0];
  const variantB = variants[1] ?? variants[0];

  const cashOrder = await call(`/api/v1/outlets/${OUTLET}/orders`, {
    method: "POST",
    token: crew.token,
    body: {
      clientTransactionId: crypto.randomUUID(),
      recordedOffline: false,
      paymentMethod: "CASH",
      cashReceived: "100000.00",
      items: [{ productVariantId: variantA.id, quantity: 1, expectedVariantPrice: variantA.price, addOns: [] }],
    },
  });
  record(
    "order CASH + kembalian",
    cashOrder.status === 201 && cashOrder.json?.data?.change !== null,
    `total=${cashOrder.json?.data?.order?.total} change=${cashOrder.json?.data?.change}`,
  );

  const qrisOrder = await call(`/api/v1/outlets/${OUTLET}/orders`, {
    method: "POST",
    token: crew.token,
    body: {
      clientTransactionId: crypto.randomUUID(),
      recordedOffline: false,
      paymentMethod: "QRIS",
      items: [
        { productVariantId: variantA.id, quantity: 1, expectedVariantPrice: variantA.price, addOns: [] },
        { productVariantId: variantB.id, quantity: 1, expectedVariantPrice: variantB.price, addOns: [] },
      ],
    },
  });
  const qrisOrderId = qrisOrder.json?.data?.order?.id;
  record(
    "order QRIS pending",
    qrisOrder.status === 201 && qrisOrder.json?.data?.order?.paymentStatus === "PENDING_RECONCILIATION",
    qrisOrder.json?.error?.code ?? qrisOrder.json?.data?.order?.paymentStatus,
  );

  const itemId = qrisOrder.json?.data?.order?.items?.[1]?.id;
  const cancelItem = await call(`/api/v1/outlets/${OUTLET}/orders/${qrisOrderId}/items/${itemId}/cancel`, {
    method: "POST",
    token: crew.token,
    body: { reason: "Salah input item (smoke)" },
  });
  record(
    "batal per item",
    cancelItem.status === 200 && cancelItem.json?.data?.itemCancellation?.newTotal !== undefined,
    cancelItem.json?.error?.code ?? `newTotal=${cancelItem.json?.data?.itemCancellation?.newTotal}`,
  );

  const paidOrderId = cashOrder.json?.data?.order?.id;
  const paidItemId = cashOrder.json?.data?.order?.items?.[0]?.id;
  const cancelPaid = await call(`/api/v1/outlets/${OUTLET}/orders/${paidOrderId}/items/${paidItemId}/cancel`, {
    method: "POST",
    token: crew.token,
    body: { reason: "Salah input (smoke)" },
  });
  record("batal item ditolak jika LUNAS", cancelPaid.status === 409, cancelPaid.json?.error?.code);

  const verify = await call(`/api/v1/outlets/${OUTLET}/orders/${qrisOrderId}/verify-qris`, {
    method: "POST",
    token: crew.token,
    body: {},
  });
  record("verifikasi QRIS", verify.status === 200, verify.json?.error?.code ?? "ok");

  const shopeeInApp = await call(`/api/v1/outlets/${OUTLET}/orders`, {
    method: "POST",
    token: crew.token,
    body: {
      platformOrderId: `SMOKE-IA-${Date.now()}`,
      recordedOffline: false,
      paymentMethod: "SHOPEEFOOD_IN_APP",
      items: [{ productVariantId: variantA.id, quantity: 1, expectedVariantPrice: variantA.price, addOns: [] }],
    },
  });
  record(
    "ShopeeFood In-App",
    shopeeInApp.status === 201 && shopeeInApp.json?.data?.order?.paymentMethod === "SHOPEEFOOD_IN_APP",
    shopeeInApp.json?.error?.code ?? shopeeInApp.json?.data?.order?.paymentMethod,
  );

  const shopeeCod = await call(`/api/v1/outlets/${OUTLET}/orders`, {
    method: "POST",
    token: crew.token,
    body: {
      platformOrderId: `SMOKE-COD-${Date.now()}`,
      recordedOffline: false,
      paymentMethod: "SHOPEEFOOD_COD",
      items: [{ productVariantId: variantA.id, quantity: 1, expectedVariantPrice: variantA.price, addOns: [] }],
    },
  });
  record(
    "ShopeeFood COD",
    shopeeCod.status === 201 && shopeeCod.json?.data?.order?.paymentMethod === "SHOPEEFOOD_COD",
    shopeeCod.json?.error?.code ?? shopeeCod.json?.data?.order?.paymentMethod,
  );

  const notifManager = await call(`/api/v1/outlets/${OUTLET}/notifications`, { token: manager.token });
  record(
    "notifikasi manager",
    notifManager.status === 200 && Array.isArray(notifManager.json?.data?.notifications),
    `count=${notifManager.json?.data?.count}`,
  );
  const notifCrew = await call(`/api/v1/outlets/${OUTLET}/notifications`, { token: crew.token });
  record(
    "notifikasi crew (scope sendiri)",
    notifCrew.status === 200 && notifCrew.json.data.notifications.every((n) => n.type === "QRIS_PENDING"),
    `count=${notifCrew.json?.data?.count}`,
  );

  const handover = await call(`/api/v1/outlets/${OUTLET}/request`, {
    method: "POST",
    token: crew.token,
    body: {
      currentOutlet: OUTLET,
      nextOutlet: OUTLET,
      summary: "Shift pagi (smoke)",
      cashHandover: "150000",
      checklistAgenda: "Cek stok",
      checklistService: "Bersihkan mesin",
      notes: "smoke test",
    },
  });
  const handoverId = handover.json?.data?.handover?.id;
  record(
    "serah terima crew kirim",
    (handover.status === 201 || handover.status === 200) && Boolean(handoverId),
    handover.json?.error?.code ?? handoverId,
  );

  const pending = await call(`/api/v1/outlets/${OUTLET}/requests?status=PENDING`, { token: manager.token });
  record(
    "serah terima manager lihat",
    pending.status === 200 &&
      (pending.json?.data?.handovers ?? []).some(
        (h) => h.id === handoverId && h.checklistService === "Bersihkan mesin",
      ),
    `pending=${pending.json?.data?.handovers?.length}`,
  );

  const decide = await call(`/api/v1/outlets/${OUTLET}/requests/${handoverId}`, {
    method: "PATCH",
    token: manager.token,
    body: { status: "ACCEPTED", notes: "Diterima (smoke)" },
  });
  record("serah terima manager terima", decide.status === 200, decide.json?.error?.code ?? decide.json?.data?.handover?.status);

  const forbidden = await call(`/api/v1/outlets/${OUTLET}/expenses`, { token: crew.token });
  record("RBAC crew ditolak di expenses", forbidden.status === 403, `HTTP ${forbidden.status}`);

  const pdf = await call(
    `/api/v1/outlets/${OUTLET}/reports/export/pdf?type=DAILY&periodKey=${today}`,
    { token: manager.token, raw: true },
  );
  record(
    "ekspor PDF",
    pdf.status === 200 &&
      pdf.text.startsWith("%PDF-1.4") &&
      pdf.headers.get("content-type") === "application/pdf",
    `len=${pdf.text.length}`,
  );

  const xlsx = await call(
    `/api/v1/outlets/${OUTLET}/reports/export/xlsx?type=DAILY&periodKey=${today}`,
    { token: manager.token, raw: true },
  );
  record(
    "ekspor XLSX",
    xlsx.status === 200 &&
      xlsx.text.includes("mso-application") &&
      (xlsx.headers.get("content-type") ?? "").includes("ms-excel"),
    `len=${xlsx.text.length}`,
  );

  // Closing paling akhir supaya tidak mengunci periode untuk tes sebelumnya.
  const closing = await call(`/api/v1/outlets/${OUTLET}/closings`, {
    method: "POST",
    token: manager.token,
    body: {
      closingType: "DAILY",
      periodKey: today,
      clientTransactionId: crypto.randomUUID(),
      actualCash: "1000.00",
      differenceReason: "Smoke test selisih",
    },
  });
  const closingRecord = closing.json?.data?.record ?? closing.json?.data;
  record(
    "closing harian + selisih",
    closing.status === 201 && Boolean(closingRecord?.id),
    closing.json?.error?.code ?? `diff=${closingRecord?.cashDifference}`,
  );

  const review = await call(
    `/api/v1/outlets/${OUTLET}/closings/${closingRecord?.id}/cash-difference`,
    {
      method: "PATCH",
      token: manager.token,
      body: { status: "SUDAH_DIKETAHUI", note: "Selesai diperiksa (smoke)" },
    },
  );
  record(
    "review status selisih kas",
    review.status === 200 && review.json?.data?.closing?.cashDifferenceStatus === "SUDAH_DIKETAHUI",
    review.json?.error?.code ?? review.json?.data?.closing?.cashDifferenceStatus,
  );

  const history = await call(`/api/v1/outlets/${OUTLET}/closings?type=DAILY`, { token: manager.token });
  record(
    "riwayat closing memuat status selisih",
    history.status === 200 &&
      (history.json?.data?.closings ?? []).some((c) => c.cashDifferenceStatus === "SUDAH_DIKETAHUI"),
    `records=${history.json?.data?.closings?.length}`,
  );

  const failed = results.filter((item) => !item.ok);
  console.log(`\nRINGKASAN: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length > 0) {
    console.log("GAGAL:", failed.map((item) => item.name).join(", "));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("SMOKE ERROR:", error.message);
  process.exitCode = 1;
});
