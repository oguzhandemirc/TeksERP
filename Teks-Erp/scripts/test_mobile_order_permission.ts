// TEST: `mobile:siparis` — mobil "Yeni Sipariş" ekranının izin SINIRI.
//
// Gerçek Express app'i ephemeral portta kaldırır ve GERÇEK login token'larıyla
// koşar (mock YOK): verifyToken + requireAnyPermission + Zod + error.middleware
// zincirinin tamamı sınanır.
//
// NEDEN BU TEST VAR:
// Yeni bir mobil ekran açarken kolay hata, izni "çalışsın diye" gereğinden geniş
// vermektir. `mobile:siparis` bilinçli olarak DAR tanımlandı: sipariş LİSTELER ve
// AÇAR, ama düzenleyemez / iptal edemez / silemez / manuel kapatamaz. Bu sınır
// yalnız route dosyalarındaki argüman listelerinde yaşıyor — biri "pratik olsun"
// diye `PATCH /orders/:id`e de eklerse hiçbir şey kırmızı vermez ve satış
// temsilcisi sessizce sipariş silebilir hâle gelir. Test o sınırın aynasıdır.
//
// ⚠️ SINIR 2026-08-05'te BİR KEZ genişledi: liste (`GET /orders`) "yasak"
// tarafındayken "izinli" tarafa geçti. Sebep ürün kararı — sipariş açan kişi
// açtığını göremezse ekran yarım kalıyordu. Bu bloğu bir daha değiştirirken
// aynısını yap: kararı yaz, testi taşı; sessizce genişletme.
//
// İkinci güvence: ekranın ÇALIŞMASI için gereken okuma uçları (kumaş, renk,
// müşteri, şube, stok ipucu) bu tek izinle AÇIK olmalı. Biri kapanırsa ekran
// sahada boş listeyle açılır — 403 toast'ı picker'ın içinde kaybolur.
//
// Çalıştır (dev DB + .env JWT_SECRET): npx tsx scripts/test_mobile_order_permission.ts
import type { AddressInfo } from "net";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const stamp = `${Date.now()}`.slice(-8);
const ORDER_USERNAME = `mobsip${stamp}`;
const NOPERM_USERNAME = `mobsipnp${stamp}`;
const PASSWORD = "TestMobSip2026!";

let orderUserId = "";
let noPermUserId = "";
const createdOrderIds: string[] = [];

/** Test kullanıcısı — tek izinle. `permissions` tablosundan çözülür (katalog
 *  değil DB: boot uzlaştırması katalogu zaten oraya yazar). */
async function createUser(username: string, permissionCodes: string[]): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username,
      fullName: `Mobil Sipariş Test (${username})`,
      passwordHash: await AuthService.hashPassword(PASSWORD),
    },
    select: { id: true },
  });
  if (permissionCodes.length > 0) {
    const perms = await prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
      select: { id: true, code: true },
    });
    if (perms.length !== permissionCodes.length) {
      const found = new Set(perms.map((p) => p.code));
      throw new Error(
        `izin DB'de yok: ${permissionCodes.filter((c) => !found.has(c)).join(", ")} ` +
          `— backend en az bir kez ayağa kalkıp katalogu uzlaştırmalı`,
      );
    }
    await prisma.userPermission.createMany({
      data: perms.map((p) => ({ userId: user.id, permissionId: p.id })),
    });
  }
  return user.id;
}

async function main(): Promise<void> {
  // ── Fixture: kumaş + müşteri (seed/fabrika master-data'sı; business-key ile) ──
  const item = await prisma.item.findFirst({
    where: { isActive: true, itemType: "FABRIC" },
    select: { id: true, name: true },
  });
  const customer = await prisma.customer.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  if (!item || !customer) throw new Error("fixture eksik: aktif kumaş ya da müşteri yok");

  orderUserId = await createUser(ORDER_USERNAME, ["mobile:siparis"]);
  noPermUserId = await createUser(NOPERM_USERNAME, []);

  const server = app.listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`Test server :${port}`);

  try {
    // clientType default 'mobile' — yalnız mobil izinli hesap Electron'a
    // giremez (canEnterApp), mobil girişinde sorun yok.
    const login = async (username: string): Promise<string> => {
      const r = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: PASSWORD }),
      });
      const j = (await r.json()) as { data?: { token?: string }; token?: string };
      const token = j.data?.token ?? j.token;
      if (!token) throw new Error(`login başarısız (${username}): HTTP ${r.status}`);
      return token;
    };

    const orderToken = await login(ORDER_USERNAME);
    const noPermToken = await login(NOPERM_USERNAME);

    const call = async (
      token: string,
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ status: number; json: Record<string, unknown> }> => {
      const r = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      let json: Record<string, unknown> = {};
      try {
        json = (await r.json()) as Record<string, unknown>;
      } catch {
        /* gövdesiz yanıt */
      }
      return { status: r.status, json };
    };

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── 1) Ekranın ÇALIŞMASI için gereken okuma uçları AÇIK ──");
    // Biri kapalıysa picker sahada boş açılır ve 403 modalın içinde kaybolur.
    const reads: Array<[string, string]> = [
      ["kumaş listesi", "/api/items?pageSize=5"],
      ["renk listesi (public scope)", "/api/colors?pageSize=5&scope=public"],
      ["renk listesi (müşteriye atanmış)", `/api/colors?pageSize=5&assignedTo=${customer.id}`],
      ["müşteri listesi", "/api/customers?pageSize=5"],
      ["müşteri şubeleri", `/api/customers/${customer.id}/branches`],
      ["stok ipucu (spec-availability)", `/api/orders/spec-availability?itemId=${item.id}`],
      // 2026-08-05: sipariş LİSTESİ artık izinli — ekranın ana görünümü bu.
      ["sipariş listesi (offset)", "/api/orders?pageSize=5"],
      ["sipariş listesi (cursor — mobil sayfalama)", "/api/orders?mode=cursor&limit=5&withTotal=true"],
    ];
    for (const [label, path] of reads) {
      const res = await call(orderToken, "GET", path);
      check(`${label} → 200`, res.status === 200, `HTTP ${res.status}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── 2) Sipariş AÇMA açık ──");
    const clientToken = crypto.randomUUID();
    const payload = {
      customerId: customer.id,
      clientToken,
      lines: [{ itemId: item.id, colorId: null, quantity: 123.5, width: 150 }],
    };
    const created = await call(orderToken, "POST", "/api/orders", payload);
    check("POST /orders → 201", created.status === 201, `HTTP ${created.status}`);
    const createdData = created.json.data as { id?: string; orderNumber?: string } | undefined;
    const orderId = createdData?.id ?? "";
    if (orderId) createdOrderIds.push(orderId);
    check("sipariş numarası üretildi", /^SIP\d{10}$/.test(createdData?.orderNumber ?? ""), createdData?.orderNumber ?? "—");

    // İdempotency: AYNI clientToken → yeni kayıt DOĞMAZ (mobil ekran timeout
    // sonrası aynı anahtarla tekrar gönderir; bkz. offline/entryAttempt.ts).
    const replay = await call(orderToken, "POST", "/api/orders", payload);
    const replayData = replay.json.data as { id?: string } | undefined;
    check(
      "aynı clientToken ile tekrar gönderim mükerrer sipariş AÇMAZ",
      replayData?.id === orderId,
      `replay id=${replayData?.id ?? "—"} HTTP ${replay.status}`,
    );
    const countSameToken = await prisma.order.count({ where: { clientToken } });
    check("DB'de tek satır", countSameToken === 1, `${countSameToken} satır`);

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── 3) SINIR: okur + yaratır, DEĞİŞTİREMEZ ──");
    // Bu blok bilinçli bir ürün kararının aynasıdır. Buradan biri kırmızıya
    // dönerse ya route genişletilmiştir ya da karar değişmiştir — ikisi de
    // düşünülerek yapılmalı, kazara değil.
    const denied: Array<[string, string, string, unknown?]> = [
      ["sipariş DÜZENLEME", "PATCH", `/api/orders/${orderId}`, { currency: "USD" }],
      ["sipariş SİLME", "DELETE", `/api/orders/${orderId}`],
      ["kalıcı SİLME", "DELETE", `/api/orders/${orderId}/permanent`],
      ["manuel KAPATMA", "POST", `/api/orders/${orderId}/manual-close`, { reason: "test" }],
    ];
    for (const [label, method, path, body] of denied) {
      const res = await call(orderToken, method, path, body);
      check(`${label} → 403`, res.status === 403, `HTTP ${res.status}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── 4) NEGATİF: izinsiz kullanıcı hiçbirini yapamaz ──");
    // Yukarıdaki 200'ler "uç herkese açık" olduğu için değil, İZİN verildiği
    // için geliyor olmalı — bu blok olmadan 1. bölüm vakumen yeşil kalırdı.
    const noPermChecks: Array<[string, string]> = [
      ["kumaş listesi", "/api/items?pageSize=5"],
      ["renk listesi", "/api/colors?pageSize=5"],
      ["müşteri listesi", "/api/customers?pageSize=5"],
      ["stok ipucu", `/api/orders/spec-availability?itemId=${item.id}`],
      ["sipariş listesi", "/api/orders?pageSize=5"],
    ];
    for (const [label, path] of noPermChecks) {
      const res = await call(noPermToken, "GET", path);
      check(`izinsiz — ${label} → 403`, res.status === 403, `HTTP ${res.status}`);
    }
    const noPermCreate = await call(noPermToken, "POST", "/api/orders", {
      customerId: customer.id,
      clientToken: crypto.randomUUID(),
      lines: [{ itemId: item.id, quantity: 10 }],
    });
    check("izinsiz — POST /orders → 403", noPermCreate.status === 403, `HTTP ${noPermCreate.status}`);

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── 5) Doğrulama hataları Türkçe + kesin 4xx ──");
    // Mobil `entryAttempt` sözleşmesi buna dayanır: kesin 4xx'te istemci
    // clientToken'ı TAZELER (yapışkan token sonsuz retry döngüsü kurardı).
    const noLines = await call(orderToken, "POST", "/api/orders", {
      customerId: customer.id,
      clientToken: crypto.randomUUID(),
      lines: [],
    });
    check("kalemsiz sipariş → 400", noLines.status === 400, `HTTP ${noLines.status}`);
    check(
      "hata mesajı Türkçe",
      typeof noLines.json.message === "string" && /kalem/i.test(noLines.json.message as string),
      String(noLines.json.message ?? "—"),
    );
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
    await cleanup();
  }
}

async function cleanup(): Promise<void> {
  // Test kendi yarattığını siler (script sözleşmesi). Sipariş satırları
  // OrderLine.orderId onDelete: Cascade ile düşer.
  for (const id of createdOrderIds) {
    await prisma.order.delete({ where: { id } }).catch(() => {});
  }
  for (const userId of [orderUserId, noPermUserId].filter(Boolean)) {
    await prisma.userPermission.deleteMany({ where: { userId } }).catch(() => {});
    // Login `Session` kaydı doğurur (jti registry) → user'dan ÖNCE silinmeli
    // (sessions.userId onDelete Restrict).
    await prisma.session.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
