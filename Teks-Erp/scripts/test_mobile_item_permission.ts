// TEST: `mobile:kumas` — mobil "Kumaş Ekle" ekranının izin SINIRI.
//
// Gerçek Express app'i ephemeral portta kaldırır ve GERÇEK login token'larıyla
// koşar (mock YOK): verifyToken + requireAnyPermission + error.middleware zinciri.
//
// NEDEN BU TEST VAR:
// `mobile:kumas` bilinçli olarak DAR: yeni kumaş tanımı AÇAR ve ekranın picker'ları
// için renk/özellik/kumaş listelerini okur — ama mevcut kumaşı DÜZENLEYEMEZ,
// pasife ALAMAZ, silemez. Master-data'da düzenleme yetkisi ayrı bir sorumluluk:
// sahadaki bir kullanıcının yanlışlıkla üretimde kullanılan bir kumaşı pasife
// alması, o kumaşı kullanan tüm ekranları sessizce boşaltır.
//
// Ayrıca `mobile:kk1-desen` ile KARIŞTIRILMAMALI: o yalnız `POST /items/quick-create`
// (ad-only + pendingReview) açar. Bu test ikisinin ayrı kaldığını da doğrular.
//
// Çalıştır (dev DB + .env JWT_SECRET): npx tsx scripts/test_mobile_item_permission.ts
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
const ITEM_USERNAME = `mobkumas${stamp}`;
const NOPERM_USERNAME = `mobkumasnp${stamp}`;
const PASSWORD = "TestMobKumas2026!";

let itemUserId = "";
let noPermUserId = "";
const createdItemIds: string[] = [];

async function createUser(username: string, permissionCodes: string[]): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username,
      fullName: `Mobil Kumaş Test (${username})`,
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
  itemUserId = await createUser(ITEM_USERNAME, ["mobile:kumas"]);
  noPermUserId = await createUser(NOPERM_USERNAME, []);

  const server = app.listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`Test server :${port}`);

  try {
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

    const itemToken = await login(ITEM_USERNAME);
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
    console.log("\n── 1) Ekranın picker'ları için gereken okumalar AÇIK ──");
    // Biri kapalıysa form sahada boş listeyle açılır ve 403 modalın içinde kaybolur.
    for (const [label, path] of [
      ["kumaş listesi", "/api/items?pageSize=5"],
      ["renk listesi", "/api/colors?pageSize=5"],
      ["özellik listesi", "/api/fabric-properties?pageSize=5"],
    ] as Array<[string, string]>) {
      const res = await call(itemToken, "GET", path);
      check(`${label} → 200`, res.status === 200, `HTTP ${res.status}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── 2) Kumaş EKLEME açık + Electron ile aynı alanlar ──");
    const color = await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } });
    const prop = await prisma.fabricProperty.findFirst({ where: { isActive: true }, select: { id: true } });

    const created = await call(itemToken, "POST", "/api/items", {
      name: `TEST MOBIL KUMAS ${stamp}`,
      itemType: "FABRIC",
      isActive: true,
      allowedColorIds: color ? [color.id] : [],
      allowedPropertyIds: prop ? [prop.id] : [],
    });
    check("POST /items → 201", created.status === 201, `HTTP ${created.status}`);
    const item = created.json.data as { id?: string; code?: string; unit?: string; pendingReview?: boolean } | undefined;
    const itemId = item?.id ?? "";
    if (itemId) createdItemIds.push(itemId);

    // Kod boş gönderildi → backend STK-NNNNNN üretmeli (ekran da boş bırakmayı önerir).
    check("kod otomatik üretildi (STK-)", /^STK-\d+$/.test(item?.code ?? ""), item?.code ?? "—");
    // Birim SORULMAZ, tipten türer — Electron `unitForItemType` ile aynı sözleşme.
    check("birim tipten türedi (FABRIC→MT)", item?.unit === "MT", `unit=${item?.unit}`);
    // Bu ekran tam tanım açar; KK1 "hızlı desen" gibi onay bekleyen kayıt DEĞİL.
    check("pendingReview işaretlenmedi", item?.pendingReview === false, `pendingReview=${item?.pendingReview}`);

    if (itemId) {
      const links = await prisma.item.findUnique({
        where: { id: itemId },
        select: {
          allowedColors: { select: { colorId: true } },
          allowedProperties: { select: { propertyId: true } },
        },
      });
      check(
        "izinli renk bağı kuruldu",
        !color || links?.allowedColors.some((c) => c.colorId === color.id) === true,
      );
      check(
        "izinli özellik bağı kuruldu",
        !prop || links?.allowedProperties.some((p) => p.propertyId === prop.id) === true,
      );
    }

    // Manuel kod: STK- öneki backend'de REDDEDİLİR (ekran da baştan engeller —
    // iki kapı bilinçli: istemci hızlı söyler, sunucu garanti eder).
    const stkCode = await call(itemToken, "POST", "/api/items", {
      name: `TEST MOBIL STK ${stamp}`,
      itemType: "FABRIC",
      code: `STK-${stamp}`,
    });
    check("STK- önekli manuel kod → 400", stkCode.status === 400, `HTTP ${stkCode.status}`);

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── 3) SINIR: ekler, DEĞİŞTİREMEZ ──");
    // Bilinçli ürün kararının aynası. Buradan biri kırmızıya dönerse ya route
    // genişletilmiştir ya da karar değişmiştir — ikisi de düşünülerek yapılmalı.
    const denied: Array<[string, string, string, unknown?]> = [
      ["kumaş DÜZENLEME", "PATCH", `/api/items/${itemId}`, { name: "DEGISTI" }],
      ["kumaş PASİFE ALMA", "DELETE", `/api/items/${itemId}`],
      // KK1-içi hızlı desen AYRI izin (`mobile:kk1-desen`) — bu ekran onu açmaz.
      ["KK1 hızlı desen", "POST", "/api/items/quick-create", { name: `TEST QC ${stamp}` }],
    ];
    for (const [label, method, path, body] of denied) {
      const res = await call(itemToken, method, path, body);
      check(`${label} → 403`, res.status === 403, `HTTP ${res.status}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── 4) NEGATİF: izinsiz kullanıcı hiçbirini yapamaz ──");
    // Bu blok olmadan 1. bölüm vakumen yeşil kalırdı ("uç zaten herkese açık" mı,
    // yoksa İZİN mi çalışıyor — ayırt edilemezdi).
    for (const [label, path] of [
      ["kumaş listesi", "/api/items?pageSize=5"],
      ["renk listesi", "/api/colors?pageSize=5"],
      ["özellik listesi", "/api/fabric-properties?pageSize=5"],
    ] as Array<[string, string]>) {
      const res = await call(noPermToken, "GET", path);
      check(`izinsiz — ${label} → 403`, res.status === 403, `HTTP ${res.status}`);
    }
    const noPermCreate = await call(noPermToken, "POST", "/api/items", {
      name: `TEST NOPERM ${stamp}`,
      itemType: "FABRIC",
    });
    check("izinsiz — POST /items → 403", noPermCreate.status === 403, `HTTP ${noPermCreate.status}`);

    // ────────────────────────────────────────────────────────────────────────
    console.log("\n── 5) Doğrulama hataları Türkçe + kesin 4xx ──");
    const noName = await call(itemToken, "POST", "/api/items", { itemType: "FABRIC" });
    check("adsız kumaş → 400", noName.status === 400, `HTTP ${noName.status}`);
    // Mesaj "Ürün ismi zorunlu" — `/isim/` yazıp bu kontrolü kırmızıya düşürdüm:
    // "ismi" içinde "isim" GEÇMEZ (i-s-m-i). Alan adına değil, hatanın hangi
    // alandan bahsettiğine bak.
    check(
      "hata mesajı Türkçe + alanı söylüyor",
      typeof noName.json.message === "string" && /ürün|isim|ism/i.test(noName.json.message as string),
      String(noName.json.message ?? "—"),
    );
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
    await cleanup();
  }
}

async function cleanup(): Promise<void> {
  // Test kendi yarattığını siler (script sözleşmesi).
  for (const id of createdItemIds) {
    await prisma.itemAllowedColor.deleteMany({ where: { itemId: id } }).catch(() => {});
    await prisma.itemAllowedProperty.deleteMany({ where: { itemId: id } }).catch(() => {});
    await prisma.item.delete({ where: { id } }).catch(() => {});
  }
  // Ada göre artık kalmasın (400 dönen denemeler kayıt bırakmaz ama garanti olsun).
  await prisma.item.deleteMany({ where: { name: { contains: stamp } } }).catch(() => {});
  for (const userId of [itemUserId, noPermUserId].filter(Boolean)) {
    await prisma.userPermission.deleteMany({ where: { userId } }).catch(() => {});
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
