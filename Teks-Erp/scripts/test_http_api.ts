// =============================================================================
// Test: HTTP-katman entegrasyonu — Express app GERÇEKTEN ayağa kaldırılır (fetch)
// Çalıştır: npx tsx scripts/test_http_api.ts
// =============================================================================
// NEDEN: Mevcut test_*.ts'ler servis sınıfını + prisma'yı DOĞRUDAN import eder,
// HTTP yok → route handler + verifyToken + requirePermission (RBAC) + Zod parse +
// error.middleware (AppError/Prisma → HTTP status) katmanı HİÇ test edilmiyordu.
// Bu dosya o boşluğu kapatır: app'i efemeral portta dinletir, Node global fetch
// ile uçları çağırır. jest/vitest KULLANMAZ (CLAUDE.md "backend jest/vitest YOK").
//
// Doğrulananlar:
//   Auth/Zod : login başarılı(200+token) · yanlış şifre(401) · eksik alan(400 Zod)
//   verifyToken : token yok(401) · bozuk token(401) · geçerli(200)
//   RBAC : yetkisiz kullanıcı requirePermission(403) + requireAnyPermission(403)
//   Yazma : create(201) · kod backend-authoritative (istemci `code` yok sayılır → MUS…)
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

interface Res {
  status: number;
  body: Record<string, unknown>;
}

async function main() {
  // Efemeral port (0) → çalışan dev/CI sunucusuyla çakışmaz.
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const call = async (
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ): Promise<Res> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const r = await fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await r.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { status: r.status, body };
  };

  let createdCustomerId: string | null = null;
  let dupCustomerId: string | null = null;
  let lowUserId: string | null = null;

  try {
    // ---- 1) AUTH: login başarılı ----
    // Kimlik seed'in `admin`'inden DEĞİL, testin kendi ürettiği fixture'dan gelir:
    // dev DB fabrikanın canlı yedeği olabilir ve orada `admin` şifresi bizimki
    // değildir (bkz. scripts/fixture-test-user.ts başlığı).
    const cred = await ensureTestAdmin();
    const ok = await call("POST", "/api/auth/login", {
      body: { username: cred.username, password: cred.password },
    });
    const data = (ok.body.data ?? {}) as Record<string, unknown>;
    const adminToken = data.token as string | undefined;
    check(`login ${cred.username} → 200`, ok.status === 200, `status=${ok.status}`);
    check("login → data.token döner", typeof adminToken === "string" && (adminToken?.length ?? 0) > 20);
    const perms = ((data.user as Record<string, unknown>)?.permissions ?? []) as string[];
    check("login → permissions[] dolu", Array.isArray(perms) && perms.length > 0, `n=${perms.length}`);

    // ---- 2) AUTH: yanlış şifre → 401 ----
    const badPw = await call("POST", "/api/auth/login", {
      body: { username: cred.username, password: "YANLIS-SIFRE" },
    });
    check("login yanlış şifre → 401", badPw.status === 401, `status=${badPw.status}`);
    check("401 gövdesi success:false", badPw.body.success === false);

    // ---- 3) AUTH/ZOD: eksik alan (password yok) → 400 Validasyon hatası ----
    const zodErr = await call("POST", "/api/auth/login", { body: { username: "admin" } });
    check("login eksik password → 400 (Zod boundary)", zodErr.status === 400, `status=${zodErr.status}`);
    check(
      "400 gövdesi Validasyon hatası + errors[]",
      zodErr.body.success === false && Array.isArray(zodErr.body.errors),
      String(zodErr.body.message ?? ""),
    );

    // ---- 4) verifyToken: token yok → 401 ----
    const noTok = await call("GET", "/api/items");
    check("GET /api/items token YOK → 401", noTok.status === 401, `status=${noTok.status}`);

    // ---- 5) verifyToken: bozuk token → 401 ----
    const badTok = await call("GET", "/api/items", { token: "bu.gecersiz.token" });
    check("GET /api/items bozuk token → 401", badTok.status === 401, `status=${badTok.status}`);

    // ---- 6) verifyToken: geçerli token → 200 ----
    const goodTok = await call("GET", "/api/items", { token: adminToken });
    check("GET /api/items geçerli token → 200", goodTok.status === 200, `status=${goodTok.status}`);
    check("200 gövdesi success:true + data dizi", goodTok.body.success === true && Array.isArray(goodTok.body.data));

    // ---- 7) RBAC: GEÇİCİ 0-izinli kullanıcı yarat (grantOperatorDefaults=false) + login.
    // (Seed test kullanıcıları kaldırıldı — test kendi fixture'ını üretir/temizler.)
    const lowUsername = `httprbac${Date.now()}`;
    const lowCreate = await call("POST", "/api/admin/users", {
      token: adminToken,
      body: {
        username: lowUsername,
        fullName: "HTTP RBAC Test",
        password: "test123456",
        grantOperatorDefaults: false,
        generateMobileCredentials: false,
      },
    });
    lowUserId = (((lowCreate.body.data ?? {}) as Record<string, unknown>).id as string) ?? null;
    check("0-izinli kullanıcı oluşturuldu (201)", lowCreate.status === 201, `status=${lowCreate.status}`);
    const lowLogin = await call("POST", "/api/auth/login", {
      body: { username: lowUsername, password: "test123456" },
    });
    const lowToken = ((lowLogin.body.data ?? {}) as Record<string, unknown>).token as string | undefined;
    check("yetkisiz kullanıcı login → 200 (aktif)", lowLogin.status === 200, `status=${lowLogin.status}`);

    // requireAnyPermission("item:read","mobile:kk1") — mehmet'te ikisi de yok → 403
    const lowRead = await call("GET", "/api/items", { token: lowToken });
    check("requireAnyPermission: yetkisiz GET /api/items → 403", lowRead.status === 403, `status=${lowRead.status}`);

    // requirePermission("customer:write") — yok → 403
    const lowWrite = await call("POST", "/api/customers", {
      token: lowToken,
      body: { code: `TEST-HTTP-RBAC-${Date.now()}`, name: "RBAC RED" },
    });
    check("requirePermission: yetkisiz POST /api/customers → 403", lowWrite.status === 403, `status=${lowWrite.status}`);
    check(
      "403 mesajı 'customer:write yetkisi' içerir",
      typeof lowWrite.body.message === "string" && (lowWrite.body.message as string).includes("customer:write"),
      String(lowWrite.body.message ?? ""),
    );

    // ---- 8) Yazma happy-path (admin) → 201 ----
    const code = `TEST-HTTP-${Date.now()}`;
    const created = await call("POST", "/api/customers", {
      token: adminToken,
      body: { code, name: "TEST HTTP Müşteri" },
    });
    check("POST /api/customers (admin) → 201", created.status === 201, `status=${created.status}`);
    const createdData = (created.body.data ?? {}) as Record<string, unknown>;
    createdCustomerId = (createdData.id as string) ?? null;
    check("201 gövdesi success:true + id", created.body.success === true && typeof createdData.id === "string");

    // ---- 9) kod backend-authoritative (redesign): tüm otomatik kodlar sunucuda
    // `MUS+GGAAYY+NNNN` üretilir; istemciden gelen `code` YOK SAYILIR
    // (CustomerService.create → data.code = nextCustomerCode()). Bu yüzden aynı
    // client `code` ile ikinci create duplicate ÇAKIŞMAZ — taze benzersiz kod ile
    // yine 201 döner. (Eski "aktif duplicate → 409" senaryosu artık ulaşılamaz.) ----
    const dup = await call("POST", "/api/customers", {
      token: adminToken,
      body: { code, name: "TEST HTTP Müşteri 2" },
    });
    check("aynı client kod ile ikinci create → 201 (kod backend-authoritative)", dup.status === 201, `status=${dup.status}`);
    const dupData = (dup.body.data ?? {}) as Record<string, unknown>;
    dupCustomerId = (dupData.id as string) ?? null;
    check(
      "server-üretilen kod istemci kodunu yok sayar + benzersiz",
      typeof createdData.code === "string" &&
        typeof dupData.code === "string" &&
        createdData.code !== code &&
        createdData.code !== dupData.code,
      `codes=${String(createdData.code)},${String(dupData.code)}`,
    );

    // ---- 10) F264 — RBAC MATRİS: veri-güdümlü guard (token yok→401, yetkisiz→403) ----
    // Salt-okunur koleksiyon GET'leri (path-param yok → uuid-param middleware karışmaz).
    // Mobil requireAnyPermission uçları da dahil: 0-izinli lowToken hepsinde 403 almalı
    // (mobil izne de sahip değil → 'requireAnyPermission web+mobil' zinciri kilitlenir).
    const guardMatrix: { path: string; guard: string }[] = [
      { path: "/api/work-orders", guard: "workorder:read | mobile:*" },
      { path: "/api/rolls", guard: "roll:read | mobile:*" },
      { path: "/api/orders", guard: "order:read" },
      { path: "/api/stations", guard: "station:read" },
      { path: "/api/quality-grades", guard: "quality:read" },
      { path: "/api/subcontractors", guard: "subcontractor:read | mobile:fason-* (requireAnyPermission)" },
      { path: "/api/subcontractor-categories", guard: "subcontractor:read | mobile:fason-* (requireAnyPermission)" },
    ];
    for (const rt of guardMatrix) {
      const anon = await call("GET", rt.path);
      check(`[401] GET ${rt.path} token YOK`, anon.status === 401, `status=${anon.status}`);
      const forbidden = await call("GET", rt.path, { token: lowToken });
      check(`[403] GET ${rt.path} yetkisiz`, forbidden.status === 403, `status=${forbidden.status} (${rt.guard})`);
    }
  } finally {
    // Z-A: kart hesabıyla doğar (finans açıkken) — hesap (Restrict FK) karttan ÖNCE; yoksa `.catch` kalıntı gizler.
    const kartlar = [createdCustomerId, dupCustomerId].filter((x): x is string => !!x);
    if (kartlar.length > 0) await prisma.cariAccount.deleteMany({ where: { customerId: { in: kartlar } } }).catch(() => {});
    if (createdCustomerId) {
      await prisma.customer.delete({ where: { id: createdCustomerId } }).catch(() => {});
    }
    if (dupCustomerId) {
      await prisma.customer.delete({ where: { id: dupCustomerId } }).catch(() => {});
    }
    if (lowUserId) {
      await prisma.userPermission.deleteMany({ where: { userId: lowUserId } }).catch(() => {});
      // ⚠️ ÖNCE OTURUMLAR. `sessions_userId_fkey` RESTRICT'tir ve test bu
      // kullanıcıyla login olduğu için bir session satırı doğar → user.delete
      // P2003 ile patlar. Eskiden hata `.catch(() => {})` ile YUTULUYORDU:
      // temizlik sessizce başarısız oluyor, her koşum `users` tablosunda bir
      // `httprbac*` satırı bırakıyordu (2026-08-02'de 6 artık sayıldı).
      await prisma.session.deleteMany({ where: { userId: lowUserId } }).catch(() => {});
      // Sessiz yutma YOK: temizlik düşerse artık görünür (fabrika DB'sinde
      // biriken artık, gerçek bir bulguyu gürültüye gömer).
      await prisma.user.delete({ where: { id: lowUserId } }).catch((e: unknown) => {
        console.warn(`  ⚠️  temizlik: test kullanıcısı silinemedi (${lowUserId}):`,
          e instanceof Error ? e.message.split("\n")[0] : String(e));
      });
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
