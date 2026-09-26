// =============================================================================
// BEKÇİ — İPTAL EDİLMİŞ KAYDIN TOKEN'I REPLAY EDİLEMEZ (2026-08-29 / T1-006)
// Çalıştır: npx tsx scripts/test_token_replay_cancelled.ts
// =============================================================================
// İdempotency'nin DÖRDÜNCÜ durumu: "yazıldı ama SONRADAN İPTAL EDİLDİ".
// Üç durum her yerde ele alınıyordu (hiç yazılmadı · aynı yük · başka yük);
// dördüncüsü yalnız `tambur-manual`da vardı ve orada bile İKİ KEZ elle
// yazılmıştı. Diğer üç replay okuyucusunda (KK1 ham giriş · açık kumaş ·
// sipariş) HİÇ yoktu → sunucu `success:true` + iptal edilmiş kaydın kimliğini
// dönüyordu. Operatör 100 m kumaşın kaydolduğunu sanıyor; top hiçbir envanter
// sekmesinde görünmüyor, hata da görünmüyor, kimse aramıyor.
//
// Ölçüm (saha kopyası): `clientToken` taşıyan 227 iptal/fire top = 227 canlı
// "yeniden oynatılabilir" token.
//
// §1 KK1 ham giriş     — iptal edilmiş topun token'ı → 409 ENTRY_CANCELLED
// §2 Fire (SCRAP)      — aynı kapı ("vardı, gitti" de kapanmış bir denemedir)
// §3 Sipariş           — iptal edilmiş siparişin token'ı → 409 ORDER_CANCELLED
// §4 REGRESYON         — iptal EDİLMEMİŞ kaydın replay'i BAYT BAYT aynı
// §5 Tek kaynak        — top okuyan her boğaz politikası 4. durumu tek yardımcıdan sorar; kod elle kopyalanmamış (AST)
// §6 Sevkiyat          — iptal edilmiş sevkiyatın token'ı → 409 SHIPMENT_CANCELLED
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { RollStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import * as tsAst from "typescript";
import { tokenBirimleri } from "./lib/token-yazim-tarama";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
type Hata = { message: string; code?: string; statusCode?: number } | null;
async function hataOf(fn: () => Promise<unknown>): Promise<Hata> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { message: string; statusCode?: number; details?: { code?: string } };
    return { message: err.message, code: err.details?.code, statusCode: err.statusCode };
  }
}

const ts = Date.now();
const inv = new InventoryService();
const rollIds: string[] = [];
let itemId = "";
let customerId = "";
let userId = "";

async function girisYap(token: string, qty = 100) {
  return inv.createInitialEntry(
    { itemId, initialQty: qty, width: 250, clientToken: token },
    userId,
  );
}

async function main(): Promise<void> {
  const item = await prisma.item.create({
    data: { code: `TST-TRC-${ts}`, name: `Test Token Replay ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  itemId = item.id;
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  check("fixture hazır (admin)", Boolean(admin));
  if (!admin) return;
  userId = admin.id;

  // ═══ §1 — KK1 ham giriş: iptal edilmiş topun token'ı ═══
  console.log("\n=== §1: KK1 ham giriş — iptal edilmiş token ===");
  const token1 = randomUUID();
  const r1 = (await girisYap(token1)).data as { id: string };
  rollIds.push(r1.id);
  await prisma.roll.update({ where: { id: r1.id }, data: { status: RollStatus.CANCELLED } });

  const e1 = await hataOf(() => girisYap(token1));
  check("§1: iptal edilmiş topun token'ı REDDEDİLDİ", e1 !== null, e1?.message?.slice(0, 60) ?? "SESSİZ BAŞARI!");
  check("§1: MAKİNE-OKUR kod + 409", e1?.code === "ENTRY_CANCELLED" && e1?.statusCode === 409, `${e1?.code ?? "—"} / ${e1?.statusCode ?? "—"}`);
  check(
    "§1: mesaj ne yapılacağını söylüyor (formu yeniden aç)",
    Boolean(e1?.message.includes("yeniden aç")),
  );
  const sayi1 = await prisma.roll.count({ where: { clientToken: token1 } });
  check("§1: ikinci top DOĞMADI (token hâlâ tek kayda ait)", sayi1 === 1, `${sayi1} kayıt`);

  // ═══ §2 — FİRE de kapanmış bir denemedir ═══
  console.log("\n=== §2: fire (SCRAP) edilmiş topun token'ı ===");
  const token2 = randomUUID();
  const r2 = (await girisYap(token2)).data as { id: string };
  rollIds.push(r2.id);
  await prisma.roll.update({ where: { id: r2.id }, data: { status: RollStatus.SCRAP } });
  const e2 = await hataOf(() => girisYap(token2));
  check("§2: fire edilmiş topun token'ı da REDDEDİLDİ", e2?.code === "ENTRY_CANCELLED", e2?.code ?? "SESSİZ BAŞARI!");

  // ═══ §3 — sipariş ═══
  console.log("\n=== §3: sipariş — iptal edilmiş token ===");
  const cus = await prisma.customer.create({
    data: { code: `TST-TRC-CUS-${ts}`, name: `Test Token Replay Müşteri ${ts}` },
    select: { id: true },
  });
  customerId = cus.id;
  // ⚠️ ÜRETİMDEKİ örneğin ta kendisi kullanılır (`routes/order.routes.ts`).
  // Elle kurulan bir yapılandırma `defaultInclude`u taşımaz → replay `lines`ı
  // okuyamaz, özdeşlik kontrolü yanlış çalışır ve bekçi ÜRÜNÜ değil kendi
  // kurulumunu ölçer (ilk yazımda tam bu oldu: canlı sipariş replay'i sahte
  // CLIENT_TOKEN_COLLISION verdi).
  const { orderService: orderSvc } = await import("../src/routes/order.routes");
  const token3 = randomUUID();
  const govde = { customerId, clientToken: token3, lines: [{ itemId, quantity: 120 }] };
  const o1 = (await orderSvc.create(govde, userId)).data as { id: string };
  await prisma.order.update({ where: { id: o1.id }, data: { status: "CANCELLED" } });

  const e3 = await hataOf(() => orderSvc.create(govde, userId));
  check("§3: iptal edilmiş siparişin token'ı REDDEDİLDİ", e3 !== null, e3?.message?.slice(0, 60) ?? "SESSİZ BAŞARI!");
  check("§3: MAKİNE-OKUR kod + 409", e3?.code === "ORDER_CANCELLED" && e3?.statusCode === 409, `${e3?.code ?? "—"} / ${e3?.statusCode ?? "—"}`);
  const sayi3 = await prisma.order.count({ where: { clientToken: token3 } });
  check("§3: ikinci sipariş DOĞMADI", sayi3 === 1, `${sayi3} kayıt`);

  // ═══ §4 — REGRESYON: canlı kaydın replay'i DEĞİŞMEDİ ═══
  console.log("\n=== §4: regresyon — iptal EDİLMEMİŞ kaydın replay'i ===");
  const token4 = randomUUID();
  const r4 = (await girisYap(token4)).data as { id: string };
  rollIds.push(r4.id);
  const tekrar = await girisYap(token4);
  const r4b = tekrar.data as { id: string };
  check("§4: canlı topun replay'i hâlâ BAŞARILI", tekrar.success === true);
  check("§4: aynı kaydı dönüyor (yeni top doğmuyor)", r4b.id === r4.id);
  check("§4: mesaj hâlâ idempotent retry diyor", Boolean(tekrar.message?.includes("idempotent")), tekrar.message?.slice(0, 50) ?? "");

  const token5 = randomUUID();
  const o5 = (await orderSvc.create({ customerId, clientToken: token5, lines: [{ itemId, quantity: 50 }] }, userId)).data as { id: string };
  const o5b = (await orderSvc.create({ customerId, clientToken: token5, lines: [{ itemId, quantity: 50 }] }, userId)).data as { id: string };
  check("§4: canlı siparişin replay'i hâlâ aynı kaydı dönüyor", o5b.id === o5.id);

  // ═══ §6 — SEVKİYAT: iptal edilmiş sevkiyatın token'ı (BULGU-T3-010) ═══
  // Tablet "Hemen Sevk Et" der, yanıt ağda kaybolur (token YAPIŞIR); masaüstünden
  // storno + kapatma yapılır → sevkiyat CANCELLED, çuvallar havuza döner. Tablet
  // aynı token'la yeniden gönderdiğinde eskiden `success:true` + "Sevkiyat
  // kuruldu" dönüyordu: operatör yeşili görüp evrak beklemeye geçiyor, oysa MAL
  // ÇIKMAMIŞTIR ve o sevkiyat hiçbir ekranda yok.
  console.log("\n=== §6: sevkiyat — iptal edilmiş token ===");
  {
    const { ShippingService } = await import("../src/services/shipping.service");
    const shipSvc = new ShippingService();
    const token = randomUUID();
    const dmg = `TSTREP${Date.now().toString().slice(-7)}`;
    const musteri = await prisma.customer.create({
      data: { code: `${dmg}C`.slice(0, 30), name: `${dmg} m` },
      select: { id: true },
    });
    const cuval = await prisma.sack.create({
      data: { sackNo: `${dmg}CV`.slice(0, 30), customerId: musteri.id },
      select: { id: true },
    });
    // Çuval BOŞ olamaz ("Boş çuval sevk edilemez") — içine bir top koy.
    const kumas = await prisma.item.findFirst({ where: { isActive: true, mergedIntoId: null }, select: { id: true } });
    const topSevk = await prisma.roll.create({
      data: {
        // Sevk edilebilmek icin deposu DOLU olmali: deposuz bir top stok
        // kumesinden cikamaz (`assertRollsHaveWarehouse`, 409). Uretimde
        // deposuz top dogamaz, fikstur de uretmemeli.
        warehouseId: await fixtureWarehouseId(),
        barcode: `${dmg}R`.slice(0, 30),
        itemId: kumas!.id,
        initialQty: 50,
        currentQty: 50,
        status: RollStatus.WAREHOUSE,
        sackId: cuval.id,
      },
      select: { id: true },
    });
    const kurulan = (await shipSvc.createShipment(
      { customerId: musteri.id, sackIds: [cuval.id], orderless: true, clientToken: token },
      undefined,
    )) as { data: { id: string } };
    // Sevkiyatı İPTAL et (mal çıkmamış hâle getir).
    await prisma.shipment.update({
      where: { id: kurulan.data.id },
      data: { status: "CANCELLED" },
    });
    const e6 = await hataOf(() =>
      shipSvc.createShipment(
        { customerId: musteri.id, sackIds: [cuval.id], orderless: true, clientToken: token },
        undefined,
      ),
    );
    check(
      "§6: iptal edilmiş sevkiyatın token'ı REDDEDİLDİ",
      e6 !== null && e6.code === "SHIPMENT_CANCELLED",
      e6 ? `code=${e6.code}` : "SESSİZCE GEÇTİ",
    );
    // ⚠️ 409 ŞART, 5xx DEĞİL: mobil kuyruk kesin 4xx'te token'ı BIRAKIR
    // (`entryAttempt` sözleşmesi). 5xx dönseydi token yapışır ve aynı ölü
    // sevkiyat sonsuza dek yeniden sorulurdu.
    check("§6: hata KESİN (4xx) — token bırakılabilsin", e6?.statusCode === 409, `status=${e6?.statusCode}`);
    // ADI kapının okuduğu şeydir: teardown bağlamı fonksiyon adından tanınır (§10b2).
    const temizlikSenaryo = async (): Promise<void> => {
      await prisma.roll.updateMany({ where: { id: topSevk.id }, data: { sackId: null, shipmentId: null } }).catch(() => undefined);
      await prisma.rollMovement.deleteMany({ where: { rollId: topSevk.id } }).catch(() => undefined);
      await prisma.roll.deleteMany({ where: { id: topSevk.id } }).catch(() => undefined);
      await prisma.sack.updateMany({ where: { id: cuval.id }, data: { shipmentId: null } }).catch(() => undefined);
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: kurulan.data.id } }).catch(() => undefined);
      await prisma.shipment.deleteMany({ where: { id: kurulan.data.id } }).catch(() => undefined);
      await prisma.sack.deleteMany({ where: { id: cuval.id } }).catch(() => undefined);
      await prisma.customer.deleteMany({ where: { id: musteri.id } }).catch(() => undefined);
    };
    await temizlikSenaryo();
  }

  // ═══ §5 — kural TEK KAYNAKTA (AST; metin sayımı değil) ═══
  // Politika `alive: (r) => assertRollReplayAlive(r)` ya da parantezsiz `alive: assertRollReplayAlive` yazabilir — metinde
  // "assertRollReplayAlive(" aramak ikincisini görmezdi (sessiz körlük). Ölçüt yapısaldır: TOP okuyan her boğaz politikası
  // 4. durumu tek kaynaktan sorar; `ENTRY_CANCELLED` kodu yalnız yardımcıda üretilir.
  console.log("\n=== §5: tek kaynak (AST) ===");
  const tarama = tokenBirimleri(join(__dirname, ".."));
  const icerir = (n: tsAst.Node, eslesir: (k: tsAst.Node) => boolean): boolean => eslesir(n) || (tsAst.forEachChild(n, (k) => (icerir(k, eslesir) ? true : undefined)) ?? false);
  const alan = (lit: tsAst.ObjectLiteralExpression, ad: string) =>
    lit.properties.find((p): p is tsAst.PropertyAssignment => tsAst.isPropertyAssignment(p) && p.name.getText() === ad)?.initializer;
  const topOkur = (k: tsAst.Node) =>
    tsAst.isPropertyAccessExpression(k) && ["findUnique", "findFirst"].includes(k.name.text) && tsAst.isPropertyAccessExpression(k.expression) && k.expression.name.text === "roll";
  const topPolitikalari = tarama.politikalar.filter((p) => {
    const f = p.literal && alan(p.literal, "find");
    return !!f && icerir(f, topOkur);
  });
  check("§5: top okuyan boğaz politikaları bulundu (körlük zemini)", topPolitikalari.length >= 5, topPolitikalari.map((p) => p.yer).join(", "));
  const kuralsiz = topPolitikalari.filter((p) => {
    const a = p.literal && alan(p.literal, "alive");
    return !a || !icerir(a, (k) => tsAst.isIdentifier(k) && k.text === "assertRollReplayAlive");
  });
  check("§5: ⭐ top okuyan HER boğaz politikası 4. durumu tek kaynaktan sorar (assertRollReplayAlive)", kuralsiz.length === 0, kuralsiz.map((p) => p.yer).join(", ") || "hepsi");
  const svcDir = join(__dirname, "../src/services");
  const dosyalar: string[] = [];
  const gez = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) gez(p);
      else if (e.name.endsWith(".ts")) dosyalar.push(p);
    }
  };
  gez(svcDir);
  check("§5: servis ağacı tarandı (körlük zemini)", dosyalar.length > 40, `${dosyalar.length} dosya`);
  const kopya = dosyalar.filter((f) => {
    if (f.endsWith("token-replay.helper.ts")) return false;
    const sf = tsAst.createSourceFile(f, readFileSync(f, "utf8"), tsAst.ScriptTarget.Latest, true);
    return icerir(sf, (k) => tsAst.isPropertyAssignment(k) && k.name.getText() === "code" && tsAst.isStringLiteral(k.initializer) && k.initializer.text === "ENTRY_CANCELLED");
  });
  check("§5: `ENTRY_CANCELLED` yalnız TEK KAYNAKTA üretiliyor", kopya.length === 0, kopya.map((f) => f.split("/").pop()).join(", ") || "elle kopya yok");
}

async function cleanup(): Promise<void> {
  const tokenRolls = await prisma.roll.findMany({ where: { itemId }, select: { id: true } }).catch(() => []);
  const ids = [...new Set([...rollIds, ...tokenRolls.map((r) => r.id)])];
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.orderLine.deleteMany({ where: { order: { customerId } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { customerId } }).catch(() => {});
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
}

main()
  .catch((err) => {
    console.error("Beklenmeyen hata:", err);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
