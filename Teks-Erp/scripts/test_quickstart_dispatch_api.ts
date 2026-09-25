// =============================================================================
// SMOKE + API TEST: Hızlı İş Emri fason sevki + çeki HTML — HTTP katmanı
// Çalıştır: npx tsx scripts/test_quickstart_dispatch_api.ts
// =============================================================================
// Express app GERÇEKTEN ayağa kaldırılır (app.listen(0) + global fetch) → route +
// verifyToken + requireAnyPermission (RBAC) + Zod + error.middleware + text/html
// gönderimi UÇTAN UCA test edilir. jest/vitest YOK (CLAUDE.md).
//
// SMOKE  : login → quick-start(201, dispatch) → çeki HTML(200 text/html)
// API    : 401 (token yok/bozuk) · 403 (yetkisiz) · 404 (versiyon yok) ·
//          409 (donmuş belge yok) · 400 (Zod) · content-type text/html
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import bcrypt from "bcryptjs";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestAdmin } from "./fixture-test-user";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { RollStatus } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

interface Res {
  status: number;
  contentType: string;
  text: string;
  json: Record<string, unknown> | null;
}

const createdWoIds: string[] = [];
let throwawayUserId: string | null = null;
const rollBarcodes: string[] = [];

async function main(): Promise<void> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; accept?: string } = {},
  ): Promise<Res> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.accept) headers.Accept = opts.accept;
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const r = await fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await r.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { status: r.status, contentType: r.headers.get("content-type") ?? "", text, json };
  };

  try {
    // ── Fixture'lar (seed business-key) ──
    const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
    const grade = await roleGrade("FIRST");
    const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
    const boya = await prisma.station.findFirst({
      where: { code: "BOYA_FASON" },
      select: { id: true, defaultCategory: { select: { id: true } } },
    });
    const internal = await prisma.station.findFirst({ where: { type: "INTERNAL", isActive: true }, select: { id: true } });
    const boyer = await ensureTestDyeHouse();
    if (!item || !grade || !admin || !boya?.defaultCategory || !internal) {
      throw new Error("Seed fixture eksik (önce 'npm run seed')");
    }

    // Stok toplar (115/100/83)
    let bc = 0;
    for (const qty of [115, 100, 83]) {
      const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
      const r = await prisma.roll.create({
        data: {
          barcode: `TST-QSDAPI-${rand}${bc++}`,
          itemId: item.id,
          initialQty: qty,
          currentQty: qty,
          status: RollStatus.STOCK,
          qualityGrade: grade.code,
          qualityGradeId: grade.id,
          width: 150,
          createdById: admin.id,
        },
        select: { barcode: true },
      });
      rollBarcodes.push(r.barcode!);
    }

    // ════════════════════════ SMOKE ════════════════════════
    console.log("\n── SMOKE: çekirdek akış ──");
    // Kimlik testin kendi fixture'ından (bkz. scripts/fixture-test-user.ts) —
    // dev DB fabrika yedeği olduğunda seed'in `admin/123123`'ü geçerli değildir.
    const cred = await ensureTestAdmin();
    const login = await call("POST", "/api/auth/login", {
      body: { username: cred.username, password: cred.password },
    });
    const token = ((login.json?.data as { token?: string } | undefined)?.token) ?? "";
    check("login admin → 200 + token", login.status === 200 && token.length > 20, `status=${login.status}`);

    const qs = await call("POST", "/api/work-orders/quick-start", {
      token,
      body: {
        rollBarcodes,
        steps: [
          { stationId: boya.id, requiredCategoryId: boya.defaultCategory.id, plannedSubcontractorId: boyer.id },
          { stationId: internal.id },
        ],
        width: 150,
        foldType: "2-KAT",
        dispatchFirstStep: true,
      },
    });
    const qsData = (qs.json?.data ?? {}) as { workOrder?: { id: string }; dispatch?: { id: string; dispatchNo: string } };
    if (qsData.workOrder?.id) createdWoIds.push(qsData.workOrder.id);
    check("quick-start → 201", qs.status === 201, `status=${qs.status}`);
    check("quick-start → dispatch döndü", !!qsData.dispatch?.id, JSON.stringify(qsData.dispatch));
    check("quick-start mesajı 'Fasona sevk'", String(qs.json?.message ?? "").includes("Fasona sevk"), String(qs.json?.message));

    const dispatchId = qsData.dispatch?.id ?? "";
    const htmlPath = `/api/printed-documents/SUBCONTRACTOR_DISPATCH/${dispatchId}/html`;
    const html = await call("GET", htmlPath, { token, accept: "text/html" });
    check("çeki HTML → 200", html.status === 200, `status=${html.status}`);
    check("content-type text/html", html.contentType.includes("text/html"), html.contentType);
    check("HTML KUMAŞ İRSALİYESİ + 298", html.text.includes("KUMAŞ İRSALİYESİ") && html.text.includes(">298<"));

    // ════════════════════════ API DETAY ════════════════════════
    console.log("\n── API: auth / status / content ──");
    const noTok = await call("GET", htmlPath);
    check("HTML token YOK → 401", noTok.status === 401, `status=${noTok.status}`);
    const badTok = await call("GET", htmlPath, { token: "bu.gecersiz.token" });
    check("HTML bozuk token → 401", badTok.status === 401, `status=${badTok.status}`);

    const v1 = await call("GET", `${htmlPath}?version=1`, { token, accept: "text/html" });
    check("HTML ?version=1 → 200", v1.status === 200, `status=${v1.status}`);
    const v99 = await call("GET", `${htmlPath}?version=99`, { token });
    check("HTML ?version=99 → 404 (versiyon yok)", v99.status === 404, `status=${v99.status}`);

    const ZERO = "00000000-0000-4000-8000-000000000000";
    const missing = await call("GET", `/api/printed-documents/SUBCONTRACTOR_DISPATCH/${ZERO}/html`, { token });
    check("HTML olmayan sevk → 409 (taslak/belge yok)", missing.status === 409, `status=${missing.status}`);

    const zod = await call("POST", "/api/work-orders/quick-start", { token, body: { steps: [{ stationId: internal.id }] } });
    check("quick-start rollBarcodes YOK → 400 (Zod)", zod.status === 400, `status=${zod.status}`);

    // RBAC: yetkisiz kullanıcı (yalnız customer:read) → çeki HTML 403
    console.log("\n── API: RBAC ──");
    const custRead = await prisma.permission.findFirst({ where: { code: "customer:read" }, select: { id: true } });
    if (custRead) {
      const rand = Math.floor(Math.random() * 0xffffff).toString(16);
      const u = await prisma.user.create({
        data: {
          username: `TST-QSDAPI-noperm-${rand}`,
          passwordHash: await bcrypt.hash("test123", 10),
          fullName: "Test Yetkisiz",
          isActive: true,
          permissions: { create: { permissionId: custRead.id, grantedById: admin.id } },
        },
        select: { id: true, username: true },
      });
      throwawayUserId = u.id;
      const lg = await call("POST", "/api/auth/login", { body: { username: u.username, password: "test123" } });
      const utok = ((lg.json?.data as { token?: string } | undefined)?.token) ?? "";
      check("yetkisiz kullanıcı login → 200", lg.status === 200, `status=${lg.status}`);
      const forbid = await call("GET", htmlPath, { token: utok });
      check("yetkisiz → çeki HTML 403", forbid.status === 403, `status=${forbid.status}`);
    } else {
      console.log("  (RBAC atlandı — customer:read permission seed'de yok)");
    }
  } finally {
    server.close();
  }
}

async function cleanup(): Promise<void> {
  try {
    if (throwawayUserId) {
      await prisma.systemLog.deleteMany({ where: { userId: throwawayUserId } });
      // Login artık Session kaydı yaratıyor (jti registry) → user silmeden önce temizle
      // (sessions.userId onDelete Restrict).
      await prisma.session.deleteMany({ where: { userId: throwawayUserId } });
      await prisma.user.delete({ where: { id: throwawayUserId } }).catch(() => {});
    }
    if (createdWoIds.length === 0 && rollBarcodes.length === 0) return;
    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const stepIds = steps.map((s) => s.id);
    const rolls = await prisma.roll.findMany({
      where: { OR: [{ barcode: { startsWith: "TST-QSDAPI-" } }, { currentStepId: { in: stepIds } }] },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);

    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: createdWoIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...dispatchIds, ...createdWoIds] } } });
    // Hızlı başlatma iş emrine partiyi kendisi açar (batch.autoCreateEnabled).
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    console.log("\n(test verisi temizlendi)");
  } catch (e) {
    // Yutulan temizlik hatası kalıntı bırakıyordu: bekçi kırmızı verir.
    fail++;
    console.error("❌ TEMİZLİK HATASI — kalıntı kaldı:", e instanceof Error ? e.message.split("\n").map((l) => l.trim()).filter(Boolean).pop() : e);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e instanceof Error ? e.stack : e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
