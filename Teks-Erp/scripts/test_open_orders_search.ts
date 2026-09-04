// TEST: Sevkiyat kur modalındaki SİPARİŞ ARAMASI — süzme SUNUCUDA (2026-09-04).
//
// Saha isteği: *"sevkiyat kur modalında filtreleme yok, bir müşterinin siparişini
// ararken zorlanıyoruz."*
//
// ⚠️ NEDEN SUNUCU TARAFI: `listOpenOrdersWithCoverage` sonucu `take: 300` ile
// KESER. İstemci elindeki kesilmiş diziyi süzseydi, 300'ü aşan bir cariye ait
// sipariş arandığında ekran "sonuç yok" der; operatör sipariş GERÇEKTEN dururken
// siparişsiz sevke iter ve mal hiçbir siparişe yazılmaz. Bu depoda adı konmuş
// sınıf: 2026-08-12 "top listesi filtresi — istemci süzmesi yanlış kayıt-yok
// üretir".
//
// ⚠️ §1 BİLEREK METİN TARAR (dispatchWithoutColor dersi): servis doğru olsa da
// controller `search`i okumazsa alan SESSİZCE düşer ve servisi doğrudan çağıran
// §2-§5 YEŞİL kalır. Katman zinciri ayrı ölçülür.
//
// Çalıştır:
//   DATABASE_URL=... JWT_SECRET=... npx tsx scripts/test_open_orders_search.ts
import fs from "fs";
import path from "path";
import prisma from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { buildTextSearch } from "../src/utils/query-parser";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
const read = (rel: string): string => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const TAG = `OOS${Date.now().toString().slice(-8)}`;
type Ids = { customerId: string; itemA: string; itemB: string; colorId: string; orderA: string; orderB: string };
let ids: Ids;

async function setup(): Promise<void> {
  const customer = await prisma.customer.create({ data: { name: `${TAG} ARAMA CARI`, code: `${TAG}C` } });
  const itemA = await prisma.item.create({ data: { name: `${TAG} PATOS KUMAS`, code: `${TAG}IA`, itemType: "FABRIC" } });
  const itemB = await prisma.item.create({ data: { name: `${TAG} SUPREM KUMAS`, code: `${TAG}IB`, itemType: "FABRIC" } });
  const color = await prisma.color.create({ data: { name: `${TAG} INDIGO`, code: `${TAG}CL` } });

  const orderA = await prisma.order.create({
    data: {
      orderNumber: `${TAG}-AAA`,
      customerId: customer.id,
      status: "PENDING",
      lines: { create: [{ itemId: itemA.id, colorId: color.id, quantity: 100 }] },
    },
  });
  const orderB = await prisma.order.create({
    data: {
      orderNumber: `${TAG}-BBB`,
      customerId: customer.id,
      status: "PENDING",
      lines: { create: [{ itemId: itemB.id, quantity: 200 }] },
    },
  });
  ids = { customerId: customer.id, itemA: itemA.id, itemB: itemB.id, colorId: color.id, orderA: orderA.id, orderB: orderB.id };
}

async function cleanup(): Promise<void> {
  if (!ids) return;
  await prisma.orderLine.deleteMany({ where: { orderId: { in: [ids.orderA, ids.orderB] } } });
  await prisma.order.deleteMany({ where: { id: { in: [ids.orderA, ids.orderB] } } });
  await prisma.item.deleteMany({ where: { id: { in: [ids.itemA, ids.itemB] } } });
  await prisma.color.deleteMany({ where: { id: ids.colorId } });
  await prisma.customer.deleteMany({ where: { id: ids.customerId } });
}

type Row = { order: { id: string; orderNumber: string } };
const nums = (r: { data: unknown }): string[] =>
  (r.data as Row[]).map((x) => x.order.orderNumber).sort();

async function run(): Promise<void> {
  console.log(`\n=== Sipariş arama (open-orders) — ${TAG} ===\n`);

  // ── §1 KATMAN ZİNCİRİ (metin) ────────────────────────────────────────────
  console.log("§1 `search` uçtan servise KESİNTİSİZ geçiyor mu (metin taraması)");
  const ctrl = read("src/controllers/shipping.controller.ts");
  const openOrdersBody = ctrl.slice(ctrl.indexOf("openOrders = async"), ctrl.indexOf("openOrders = async") + 900);
  check(
    "controller `openOrders` servise `search` geçirir",
    /listOpenOrdersWithCoverage\(\{[\s\S]*?search:/.test(openOrdersBody),
    "yoksa alan Zod/okuma katmanında sessizce düşer",
  );
  const svcSrc = read("src/services/shipping.service.ts");
  check(
    "servis imzası `search` alanını tanır",
    /listOpenOrdersWithCoverage\(params: \{[\s\S]*?search\?: string;/.test(svcSrc),
  );
  check(
    "süzgeç Prisma `where`e girer (istemciye ham liste + JS filter DEĞİL)",
    /const search = params\.search\?\.trim\(\);[\s\S]{0,1500}where\.OR = or;/.test(svcSrc),
  );

  await setup();

  // ── §2 SİPARİŞ NO ────────────────────────────────────────────────────────
  console.log("\n§2 sipariş numarasıyla arama");
  const all = await shippingService.listOpenOrdersWithCoverage({ customerId: ids.customerId });
  check("süzgeçsiz iki sipariş de gelir", nums(all).length === 2, nums(all).join(","));

  const byNo = await shippingService.listOpenOrdersWithCoverage({ customerId: ids.customerId, search: `${TAG}-BBB` });
  check("tam sipariş no yalnız o siparişi getirir", nums(byNo).join(",") === `${TAG}-BBB`, nums(byNo).join(","));

  // ── §3 KUMAŞ / RENK ADI ──────────────────────────────────────────────────
  console.log("\n§3 kumaş ve renk adıyla arama (satır içi ilişkiler)");
  const byItem = await shippingService.listOpenOrdersWithCoverage({ customerId: ids.customerId, search: "SUPREM" });
  check("kumaş adı satırdan bulunur", nums(byItem).join(",") === `${TAG}-BBB`, nums(byItem).join(","));

  const byColor = await shippingService.listOpenOrdersWithCoverage({ customerId: ids.customerId, search: "INDIGO" });
  check("renk adı satırdan bulunur", nums(byColor).join(",") === `${TAG}-AAA`, nums(byColor).join(","));

  const miss = await shippingService.listOpenOrdersWithCoverage({ customerId: ids.customerId, search: "ZZZYOKBOYLEBIRSEY" });
  check("eşleşmeyen terim BOŞ döner (uydurma satır yok)", nums(miss).length === 0);

  // ── §4 BOŞ TERİM ve `OR: []` SÖZLEŞMESİ ──────────────────────────────────
  // ⚠️ İLK YAZIMDA BU BÖLÜM YANLIŞ ŞEY İDDİA EDİYORDU: "'...' listeyi
  // boşaltmamalı" diye ölçüyordu ve KIRMIZI verdi. Ölçüm gösterdi ki "..."
  // gerçek bir kod aramasıdır (hiçbir sipariş numarası "..." içermez → 0 satır)
  // ve bu davranış sipariş listesinin kendi aramasıyla BİREBİR aynıdır. Yani
  // kırmızı olan üründe değil beklentideydi; beklenti düzeltildi.
  console.log("\n§4 boş terim süzgeç KURMAZ; `OR: []` sözleşmesi ölçülür");
  for (const term of ["", "   "]) {
    const r = await shippingService.listOpenOrdersWithCoverage({ customerId: ids.customerId, search: term });
    check(`boşluk terimi (${JSON.stringify(term)}) süzgeç kurmaz`, nums(r).length === 2, `${nums(r).length} satır`);
  }

  // `where.OR = []` Prisma'da "hiçbir şey eşleşmesin" demektir. Servisteki
  // `or.length > 0` dalı bu yüzden var. Bugün ULAŞILAMAZ (boş-olmayan her terim
  // >=1 cümle üretiyor); helper sözleşmesi değişip boş dizi döndürmeye
  // başlarsa BU kontrol kırmızı verir ve dalın neden durduğunu hatırlatır.
  const bts = (t: string) =>
    buildTextSearch(t, { text: ["customer.name", "lines.some.item.name"], code: ["orderNumber"] }).length;
  check("boş terim `buildTextSearch`ten [] döner (trim kapısının koruduğu yol)", bts("") === 0);
  for (const t of ["-", "...", "·", "€"]) {
    check(`"${t}" >=1 cümle üretir (dal bugün ulaşılamaz)`, bts(t) > 0, `${bts(t)} cümle`);
  }

  // ── §5 KAPSAM KORUNUR ────────────────────────────────────────────────────
  // Arama süzgeci `customerId`/statü kapsamını GENİŞLETMEMELİ: `where.OR`
  // atanırken mevcut `AND` koşullarının üstüne yazılsaydı, terim başka carinin
  // siparişini de getirirdi (sevkiyat yanlış siparişe yazılırdı).
  console.log("\n§5 arama, cari kapsamını GENİŞLETMEZ");
  const other = await prisma.customer.create({ data: { name: `${TAG} BASKA CARI`, code: `${TAG}X` } });
  const otherOrder = await prisma.order.create({
    data: {
      orderNumber: `${TAG}-XXX`,
      customerId: other.id,
      status: "PENDING",
      lines: { create: [{ itemId: ids.itemB, quantity: 50 }] },
    },
  });
  const scoped = await shippingService.listOpenOrdersWithCoverage({ customerId: ids.customerId, search: "SUPREM" });
  check(
    "başka carinin aynı kumaşlı siparişi GELMEZ",
    !nums(scoped).includes(`${TAG}-XXX`),
    nums(scoped).join(","),
  );
  await prisma.orderLine.deleteMany({ where: { orderId: otherOrder.id } });
  await prisma.order.delete({ where: { id: otherOrder.id } });
  await prisma.customer.delete({ where: { id: other.id } });
}

run()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup:", e));
    console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı\n`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
