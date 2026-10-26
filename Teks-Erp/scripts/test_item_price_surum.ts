// =============================================================================
// BEKÇİ — KALEM FİYATI DAMGALI SÜRÜMLEME (MAL-0b)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_item_price_surum.ts
//
// NEDEN: Maliyet ve geçmiş faturalar "o tarihteki fiyat"ı okur. Fiyat yerinde
// ezilir ya da satır silinirse geçmiş sessizce değişir (defter.md ③a). Bu kapı
// değişim/kaldırmanın SATIR SİLMEDİĞİNİ ve EZMEDİĞİNİ, "şu an" ile "şu tarih
// itibarıyla" okumanın tek yüklemden geçtiğini ölçer.
//
// ÖLÇÜLENLER:
//   §1 Değişim: eski satır durur + damgalı, yeni aktif, anahtar başına tek aktif
//   §2 Aynı fiyat: yeni satır doğmaz
//   §3 Kaldırma: satır durur; istisna → varsayılana, varsayılan → null (0 değil)
//   §4 As-of: pencere `[createdAt, revokedAt)`; bellek ikizi = Prisma parçası
//   §5 İki paralel değişim: tek aktif kalır, kaybeden 409
//   §6 Birleştirme: damgalı geçmiş BLOKSUZ taşınır; aktif çakışma hâlâ BLOCK
//   §7 Kaynak taraması: fiziksel silme yok, her okuma aktif süzgeçli, çağrı kümesi beyanlı
//   §8 Liste: varsayılan aktif, `includeRevoked` geçmişi de döner (rows/total aynı where)
//   §9 Bulut `fiyat` kapsamı: Prisma↔SQL ikizi + damgalı satır KAPSAM_DISI düşer
// =============================================================================
import { ItemType, PriceKind } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { itemPriceService, resolveItemPrice } from "../src/services/item-price.service";
import { isItemPriceValidAt, itemPriceValidAt } from "../src/services/helpers/item-price-validity.helper";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { findRecordProjection } from "../src/cloud-sync/projections";
import { buildRecords } from "../src/cloud-sync/record-builder";
import { aktifYuklemTara } from "./revoke-ast-tarama";

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

async function statusOf(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
    return 200;
  } catch (e) {
    return (e as { statusCode?: number }).statusCode ?? 500;
  }
}

const TAG = `IPS-${randomUUID().slice(0, 8)}`;
const itemIds: string[] = [];
const customerIds: string[] = [];
const SALE = PriceKind.SALE;

async function mkItem(suffix: string): Promise<string> {
  const r = await prisma.item.create({ data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}`, itemType: ItemType.FABRIC }, select: { id: true } });
  itemIds.push(r.id);
  return r.id;
}

async function rowsOf(itemId: string, customerId: string | null = null) {
  return prisma.itemPrice.findMany({
    where: { itemId, customerId, kind: SALE, currency: "TRY" },
    select: { id: true, price: true, createdAt: true, revokedAt: true, revokeReason: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  console.log("=== Kalem fiyatı damgalı sürüm bekçisi ===\n");
  const item = await mkItem("K1");
  const cust = await prisma.customer.create({ data: { code: `${TAG}-C1`, name: `${TAG} Müşteri`, type: "SUPPLIER" }, select: { id: true } });
  customerIds.push(cust.id);

  // ── §1 DEĞİŞİM ───────────────────────────────────────────────────────────
  await itemPriceService.upsert({ itemId: item, kind: SALE, currency: "TRY", price: 10 });
  await itemPriceService.upsert({ itemId: item, kind: SALE, currency: "TRY", price: 12 });
  const r1 = await rowsOf(item);
  check("§1a ⭐ Değişim eski satırı SİLMEDİ: iki satır", r1.length === 2, `satır=${r1.length}`);
  check(
    "§1b ⭐ Eski satır fiyatı EZİLMEDİ ve damgalı",
    r1[0]?.price.equals(10) === true && r1[0]?.revokedAt !== null && !!r1[0]?.revokeReason,
    `${r1[0]?.price}/${r1[0]?.revokedAt?.toISOString()}/${r1[0]?.revokeReason}`,
  );
  check("§1c Yeni satır aktif", r1[1]?.price.equals(12) === true && r1[1]?.revokedAt === null);
  check(
    "§1d Damga ile yeni doğum AYNI an (boşluksuz/örtüşmesiz pencere)",
    r1[0]?.revokedAt?.getTime() === r1[1]?.createdAt.getTime(),
  );
  check("§1e Anahtar başına tek aktif", r1.filter((r) => r.revokedAt === null).length === 1);

  // ── §2 AYNI FİYAT ────────────────────────────────────────────────────────
  const same = await itemPriceService.upsert({ itemId: item, kind: SALE, currency: "TRY", price: 12 });
  const r2 = await rowsOf(item);
  check("§2a Aynı fiyat yeni satır DOĞURMADI", r2.length === 2 && same.data.created === false, `satır=${r2.length}`);

  // ── §3 KALDIRMA ──────────────────────────────────────────────────────────
  await itemPriceService.upsert({ itemId: item, customerId: cust.id, kind: SALE, currency: "TRY", price: 9 });
  const exc = (await rowsOf(item, cust.id)).find((r) => r.revokedAt === null);
  await itemPriceService.remove(exc?.id ?? "");
  const excAfter = await prisma.itemPrice.findUnique({ where: { id: exc?.id ?? "" }, select: { revokedAt: true } });
  check("§3a ⭐ Kaldırılan istisna satırı DURUYOR (damgalı)", excAfter !== null && excAfter.revokedAt !== null);
  const toDef = await resolveItemPrice({ itemId: item, kind: SALE, currency: "TRY", customerId: cust.id });
  check("§3b İstisna kalkınca varsayılana döner", toDef?.source === "DEFAULT" && toDef.price.equals(12), `${toDef?.source}/${toDef?.price}`);
  const activeDef = (await rowsOf(item)).find((r) => r.revokedAt === null);
  await itemPriceService.remove(activeDef?.id ?? "");
  const none = await resolveItemPrice({ itemId: item, kind: SALE, currency: "TRY", customerId: cust.id });
  check("§3c ⭐ Varsayılan da kalkınca NULL (0 değil)", none === null, JSON.stringify(none));
  check("§3d Kaldırma hiçbir satırı silmedi", (await rowsOf(item)).length === 2 && (await rowsOf(item, cust.id)).length === 1);
  check("§3e İkinci kaldırma 409", (await statusOf(() => itemPriceService.remove(activeDef?.id ?? ""))) === 409);

  // ── §4 AS-OF ─────────────────────────────────────────────────────────────
  const asofItem = await mkItem("K2");
  await itemPriceService.upsert({ itemId: asofItem, kind: SALE, currency: "TRY", price: 100 });
  await itemPriceService.upsert({ itemId: asofItem, kind: SALE, currency: "TRY", price: 200 });
  const [a, b] = await rowsOf(asofItem);
  const day = 24 * 3600 * 1000;
  const t1 = new Date(Date.now() - 10 * day);
  const t2 = new Date(Date.now() - 5 * day);
  // Fikstür: A [t1, t2), B [t2, ∞) — geçmişi kurmak için damgalar elle geriye çekilir.
  await prisma.itemPrice.update({ where: { id: a!.id }, data: { createdAt: t1, revokedAt: t2 } });
  await prisma.itemPrice.update({ where: { id: b!.id }, data: { createdAt: t2 } });
  const at = async (d: Date) => (await resolveItemPrice({ itemId: asofItem, kind: SALE, currency: "TRY", asOf: d }))?.price.toString() ?? "null";
  check("§4a asOf(<t1) = null", (await at(new Date(t1.getTime() - day))) === "null");
  check("§4b ⭐ asOf(t1) = A (pencere başı dahil)", (await at(t1)) === "100");
  check("§4c ⭐ asOf(t1..t2) = A", (await at(new Date(t1.getTime() + day))) === "100");
  check("§4d ⭐ asOf(t2) = B (pencere sonu hariç)", (await at(t2)) === "200");
  check("§4e asOf yok = şu an = B", (await resolveItemPrice({ itemId: asofItem, kind: SALE, currency: "TRY" }))?.price.equals(200) === true);
  await itemPriceService.remove(b!.id);
  check("§4f ⭐ Kaldırılan fiyat kaldırma ÖNCESİ as-of'ta görünür", (await at(new Date(t2.getTime() + day))) === "200");
  check("§4g Kaldırma sonrası şu an = null", (await at(new Date(Date.now() + 1000))) === "null");
  const rows4 = await prisma.itemPrice.findMany({ where: { itemId: asofItem }, select: { id: true, createdAt: true, revokedAt: true } });
  const probes = [new Date(t1.getTime() - 1), t1, new Date(t1.getTime() + day), t2, new Date(t2.getTime() + day), new Date()];
  let twinOk = true;
  const twinDetail: string[] = [];
  for (const p of probes) {
    const db = new Set((await prisma.itemPrice.findMany({ where: { AND: [{ itemId: asofItem }, itemPriceValidAt(p)] }, select: { id: true } })).map((r) => r.id));
    const mem = new Set(rows4.filter((r) => isItemPriceValidAt(r, p)).map((r) => r.id));
    const same = db.size === mem.size && [...db].every((id) => mem.has(id));
    if (!same) twinOk = false;
    twinDetail.push(`${db.size}/${mem.size}`);
  }
  check("§4h ⭐ Bellek ikizi `isItemPriceValidAt` = Prisma `itemPriceValidAt` (aynı satırlar)", twinOk && rows4.length === 2, twinDetail.join(" "));

  // ── §5 PARALEL DEĞİŞİM ───────────────────────────────────────────────────
  const parItem = await mkItem("K3");
  await itemPriceService.upsert({ itemId: parItem, kind: SALE, currency: "TRY", price: 1 });
  const results = await Promise.allSettled([
    itemPriceService.upsert({ itemId: parItem, kind: SALE, currency: "TRY", price: 2 }),
    itemPriceService.upsert({ itemId: parItem, kind: SALE, currency: "TRY", price: 3 }),
  ]);
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  const ok5 = results.filter((r) => r.status === "fulfilled").length;
  const codes = rejected.map((r) => (r.reason as { statusCode?: number }).statusCode ?? 500);
  check("§5a En az biri başardı, kaybeden yalnız 409", ok5 >= 1 && codes.every((c) => c === 409), `başarılı=${ok5} red=${codes.join(",") || "-"}`);
  const r5 = await rowsOf(parItem);
  check("§5b ⭐ Paralel değişim sonrası TEK aktif satır", r5.filter((r) => r.revokedAt === null).length === 1, `aktif=${r5.filter((r) => r.revokedAt === null).length}/${r5.length}`);
  check("§5c Satır sayısı = 1 + başarılı değişim", r5.length === 1 + ok5, `satır=${r5.length}`);

  // ── §6 BİRLEŞTİRME ───────────────────────────────────────────────────────
  const surv = await mkItem("M-S");
  const src = await mkItem("M-K");
  await itemPriceService.upsert({ itemId: surv, kind: SALE, currency: "TRY", price: 50 });
  await itemPriceService.upsert({ itemId: src, kind: SALE, currency: "TRY", price: 40 });
  await itemPriceService.upsert({ itemId: src, kind: SALE, currency: "TRY", price: 45 });
  const srcActive = (await rowsOf(src)).find((r) => r.revokedAt === null);
  await itemPriceService.remove(srcActive?.id ?? "");
  const before6 = await prisma.itemPrice.count({ where: { itemId: { in: [surv, src] } } });
  const preview = await MasterDataMergeService.preview("item", surv, [src]);
  const priceConflict = preview.conflicts.find((c) => c.table === "item_prices");
  check(
    "§6a ⭐ Önizleme: kaynakta yalnız DAMGALI satır → fiyat çakışması YOK",
    !priceConflict || priceConflict.count === 0,
    JSON.stringify(priceConflict ?? null).slice(0, 120),
  );
  const mStatus = await statusOf(() => MasterDataMergeService.merge("item", { survivorId: surv, sourceIds: [src], reason: "mal-0b damgali gecmis sondasi", acknowledgedConflicts: 0 }));
  check("§6b ⭐ Birleştirme BLOKSUZ geçti", mStatus === 200, `durum=${mStatus}`);
  const after6 = await rowsOf(surv);
  check("§6c Satır sayısı korundu (geçmiş taşındı, silinmedi)", after6.length === before6, `${after6.length}/${before6}`);
  check("§6d Anahtar başına tek aktif (survivor fiyatı)", after6.filter((r) => r.revokedAt === null).length === 1 && after6.find((r) => r.revokedAt === null)?.price.equals(50) === true);
  const surv2 = await mkItem("N-S");
  const src2 = await mkItem("N-K");
  await itemPriceService.upsert({ itemId: surv2, kind: SALE, currency: "TRY", price: 50 });
  await itemPriceService.upsert({ itemId: src2, kind: SALE, currency: "TRY", price: 40 });
  const m2 = await statusOf(() => MasterDataMergeService.merge("item", { survivorId: surv2, sourceIds: [src2], reason: "mal-0b aktif cakisma sondasi", acknowledgedConflicts: 0 }));
  check("§6e ⭐ AKTİF fiyat çakışması hâlâ BLOCK (409)", m2 === 409, `durum=${m2}`);
  check("§6f BLOCK sonrası kaynağın aktif fiyatı yerinde", (await rowsOf(src2)).filter((r) => r.revokedAt === null).length === 1);

  // ── §7 KAYNAK TARAMASI ───────────────────────────────────────────────────
  const kok = join(__dirname, "..");
  const t = aktifYuklemTara(kok, [
    { delegate: "itemPrice", model: "ItemPrice", sabit: "ACTIVE_ITEM_PRICE", tablo: "item_prices", helper: join("src", "services", "helpers", "item-price-validity.helper.ts") },
  ]).get("itemPrice")!;
  check("§7a ⭐ `itemPrice.delete/deleteMany` YOK", t.silme.length === 0, t.silme.join(", ") || "0");
  check("§7b ⭐ Her okuma/güncelleme aktif süzgeç taşır", t.cagriIhlal.length === 0, `çağrı=${t.cagriSayisi}${t.cagriIhlal.length ? " İHLAL: " + t.cagriIhlal.join(", ") : ""}`);
  check("§7c İlişki okumaları süzgeçli", t.iliskiIhlal.length === 0, `ilişki=${t.iliskiSayisi}${t.iliskiIhlal.length ? " İHLAL: " + t.iliskiIhlal.join(", ") : ""}`);
  check("§7d Ham SQL başvuruları süzgeçli", t.sqlIhlal.length === 0, `sql=${t.sqlSayisi}${t.sqlIhlal.length ? " İHLAL: " + t.sqlIhlal.join(", ") : ""}`);
  console.log(`   istisnalar: ${t.istisnalar.length ? t.istisnalar.join(", ") : "yok"}`);
  // MAL-2: maliyet köprüsünün genel alış fiyatı okuyucusu ayrı dosyada (dinamik import; servis statik bağı ticaret kapısını taşırdı).
  const BEYANLI = new Set(["src/services/item-price.service.ts", "src/services/helpers/item-purchase-price.helper.ts"]);
  const callFiles = new Set<string>();
  let callCount = 0;
  for (const f of srcFiles(join(kok, "src"))) {
    const n = (readFileSync(f, "utf8").match(/\.itemPrice\.[a-zA-Z]+\(/g) ?? []).length;
    if (n > 0) {
      callFiles.add(relative(kok, f));
      callCount += n;
    }
  }
  const extra = [...callFiles].filter((f) => !BEYANLI.has(f));
  const dead = [...BEYANLI].filter((f) => !callFiles.has(f));
  check("§7e ⭐ `itemPrice` delegate çağrıları YALNIZ beyanlı dosyada (ölü beyan da kırmızı)", extra.length === 0 && dead.length === 0, `fazla=${extra.join(",") || "-"} ölü=${dead.join(",") || "-"}`);
  check("§7f Körlük zemini: tarama çağrı buldu", callCount >= 5 && t.cagriSayisi >= 5, `regex=${callCount} ast=${t.cagriSayisi}`);

  // ── §8 LİSTE ─────────────────────────────────────────────────────────────
  const lActive = await itemPriceService.list({ page: 1, pageSize: 50, filters: { itemId: item } });
  const lAll = await itemPriceService.list({ page: 1, pageSize: 50, filters: { itemId: item }, includeRevoked: true });
  check("§8a Varsayılan liste yalnız aktif (bu kalemde 0)", lActive.total === 0 && lActive.rows.length === 0, `total=${lActive.total}`);
  check("§8b `includeRevoked` geçmişi döner (rows = total)", lAll.total === 3 && lAll.rows.length === lAll.total, `total=${lAll.total} rows=${lAll.rows.length}`);

  // ── §9 BULUT KAPSAMI ─────────────────────────────────────────────────────
  const proj = findRecordProjection("fiyat");
  check("§9a `fiyat` projeksiyonu kapsamlı, silme stratejisi YOK", !!proj?.scope && proj.deletion === "YOK", `${proj?.deletion}`);
  if (proj?.scope) {
    const ids = [item, asofItem, parItem, surv];
    const pc = await prisma.itemPrice.count({ where: { AND: [{ itemId: { in: ids } }, proj.scope.prismaWhere as object] } });
    const sq = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM item_prices t WHERE t."itemId" = ANY($1::uuid[]) AND ${proj.scope.sql}`,
      ids,
    );
    check("§9b ⭐ Kapsam Prisma ↔ SQL ikizi aynı sayım", pc === Number(sq[0]?.n ?? -1) && pc > 0, `${pc}/${sq[0]?.n}`);
    const activeRow = (await rowsOf(parItem)).find((r) => r.revokedAt === null)!;
    const revokedRow = (await rowsOf(parItem)).find((r) => r.revokedAt !== null)!;
    const built = await buildRecords(proj, [activeRow.id, revokedRow.id], Date.now());
    const allRows = [...built.rows.values()].flat();
    check(
      "§9c ⭐ Damgalı satır KAPSAM_DISI düşer, aktif satır gider",
      built.removed.some((r) => r.id === revokedRow.id && r.neden === "KAPSAM_DISI") &&
        !built.removed.some((r) => r.id === activeRow.id) &&
        allRows.some((r) => r.id === activeRow.id) && !allRows.some((r) => r.id === revokedRow.id),
      JSON.stringify(built.removed),
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // Fikstür temizliği — üretim yolu değil (birleştirme izleri FK'lıysa sessiz geç).
    await prisma.itemPrice.deleteMany({ where: { itemId: { in: itemIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } }).catch(() => {});
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
