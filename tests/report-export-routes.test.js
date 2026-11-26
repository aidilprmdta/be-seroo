import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createReportRoutes } from "../src/reports/routes.js";
import { ReportError } from "../src/reports/errors.js";

const NOW = new Date("2026-11-25T10:00:00.000Z");

function createPrisma({ role = "MANAGER" } = {}) {
  const audits = [];
  return {
    audits,
    outletMembership: {
      async findUnique() {
        return { role, outlet: { isActive: true } };
      },
    },
    outlet: {
      async findUnique() {
        return { id: "outlet-a", name: "Seroo Rumbai", code: "RMB" };
      },
    },
    closingRecord: {
      async findUnique() {
        return null;
      },
    },
    order: {
      async findMany() {
        return [
          {
            id: "order-1",
            outletId: "outlet-a",
            total: "15000",
            paymentMethod: "CASH",
            paymentStatus: "LUNAS",
            createdAt: NOW,
            items: [
              {
                productName: "Teh Tarik",
                variantName: "Medium",
                quantity: 1,
                subtotal: "15000",
              },
            ],
            payments: [
              { paymentMethod: "CASH", amount: "15000", paymentStatus: "LUNAS" },
            ],
          },
        ];
      },
    },
    expense: {
      async findMany() {
        return [];
      },
    },
    auditLog: {
      async create({ data }) {
        audits.push(data);
        return { id: `audit-${audits.length}` };
      },
    },
  };
}

function createApp(prisma) {
  const authenticate = async (c, next) => {
    c.set("auth", { userId: "user-1", sessionId: "session-1" });
    await next();
  };
  const routes = createReportRoutes({
    prisma,
    authenticationMiddleware: authenticate,
    now: () => NOW,
  });
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof ReportError) {
      return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
    }
    return c.json({ success: false, error: { code: "INTERNAL_SERVER_ERROR", message: error.message } }, 500);
  });
  return app.route("/api/v1/outlets", routes);
}

test("PDF export route returns application/pdf with attachment filename", async () => {
  const prisma = createPrisma();
  const app = createApp(prisma);
  const response = await app.request(
    "/api/v1/outlets/outlet-a/reports/export/pdf?type=DAILY&periodKey=2026-11-25",
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(
    response.headers.get("content-disposition"),
    /attachment; filename="laporan-RMB-daily-2026-11-25\.pdf"/,
  );
  assert.ok(body.startsWith("%PDF-1.4"));
  assert.ok(body.includes("Teh Tarik"));
  assert.equal(prisma.audits[0].action, "REPORT_EXPORTED");
  assert.equal(prisma.audits[0].metadata.format, "PDF");
});

test("XLSX export route returns Excel-compatible SpreadsheetML", async () => {
  const prisma = createPrisma();
  const app = createApp(prisma);
  const response = await app.request(
    "/api/v1/outlets/outlet-a/reports/export/xlsx?type=DAILY&periodKey=2026-11-25",
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/vnd\.ms-excel/);
  assert.match(response.headers.get("content-disposition"), /\.xls"/);
  assert.ok(body.includes("<?mso-application progid=\"Excel.Sheet\"?>"));
  assert.ok(body.includes("Seroo Rumbai"));
  assert.ok(body.includes("BELUM CLOSING - BUKAN LAPORAN FINAL"));
});

test("csv and html exports still resolve to their own handlers", async () => {
  const app = createApp(createPrisma());
  const csv = await app.request(
    "/api/v1/outlets/outlet-a/reports/export/csv?type=DAILY&periodKey=2026-11-25",
  );
  const html = await app.request(
    "/api/v1/outlets/outlet-a/reports/export/html?type=DAILY&periodKey=2026-11-25",
  );

  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type"), /text\/html/);
});

test("unsupported export format is rejected", async () => {
  const app = createApp(createPrisma());
  const response = await app.request(
    "/api/v1/outlets/outlet-a/reports/export/docx?type=DAILY&periodKey=2026-11-25",
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("crew cannot export reports", async () => {
  const app = createApp(createPrisma({ role: "CREW" }));
  const response = await app.request(
    "/api/v1/outlets/outlet-a/reports/export/pdf?type=DAILY&periodKey=2026-11-25",
  );

  assert.equal(response.status, 403);
});
