// =============================================================================
// test_siparis_teyidi — Seyitoğlu 3. bölüm L1: sipariş teyidi basılı belgesi (ORDER_CONFIRMATION)
// =============================================================================
//   §1 içerik: no = sipariş no, iptal edilmemiş satırlar (ürün, renk, en, miktar, birim, fiyat, tutar, tolerans),
//      fiyatsız satır tutarı null (0 değil), toplam = sipariş toplamı; iç alan (kesim notu, sevk, reçete) YOK
//   §2 çıktı: HTML başlık/no/fabrika günü/termin; Excel tablosu HTML ile aynı kolonlar; fiyatsız teyit
//      `columns.kalemler.hidden` ile fiyat kolonları düşer
//   §3 yaşam döngüsü: ilk açılışta donar, sipariş değişse de aynı sürüm; yeniden basım v2 güncel veriyle;
//      iki iptal yolunda (cancelWithActions · softDelete) belge VOIDED; belgesiz iptal VOIDED doğar
//   §4 statik: izin satırı sipariş uçlarıyla hizalı (order:read|write), iki iptal yolu void çağırır
//   §5 tasarımcı: sözleşme kayıtlı (müşteri belgesi, `ic` alan yok), "Sistemden kopyala" 409 vermez,
//      gerçek donmuş belgede Liquid eşleniği fiyatlı/fiyatsız satırı Sistem'le aynı basar, fiyatsız
//      teyit (`columns.kalemler.hidden`) tasarımcı çıktısında da fiyat/tutar kolonunu düşürür
// Negatif sonda (2026-11-12): (A) `cancelWithActions`taki `voidOrderConfirmationTx` kaldırıldı → §3c §3d §4b ❌ (15/3);
// (B) select'e `cutNote` eklenip satıra yayıldı → §1e ❌ (17/1); geri alındı.
// Çalıştır: npx tsx scripts/test_siparis_teyidi.ts (yalnız test DB)
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, PrintedDocType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { printedDocumentService, type PrintedDocSnapshot } from "../src/services/printed-document.service";
import "../src/services/order-documents.service";
import { renderOrderConfirmationHtml, renderOrderConfirmationTables, type OrderConfirmationDoc } from "../src/services/document-render/order-confirmation.html";
import type { DocTablesPayload } from "../src/services/document-render/doc-model";
import { factoryDateTr } from "../src/constants/time";
import { orderService } from "../src/routes/order.routes";
import { contractPaths, getContract } from "../src/services/document-template/sozlesme/kayit";
import { getSystemEquivalent, materializeEquivalent } from "../src/services/document-template/sistem/kayit";
import { renderTemplate } from "../src/services/document-template/motor/render";
import { createTemplate } from "../src/services/document-template/template.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const OC = PrintedDocType.ORDER_CONFIRMATION;
const TAG = `TEST-SYL1-${Date.now().toString(36).toUpperCase()}`;
const LEAK = `${TAG}-SIZINTI-KESIM`;
const made = { customer: "", item: "", color: "", orders: [] as string[], templates: [] as string[] };
const docs = (id: string) => prisma.printedDocument.findMany({ where: { docType: OC, sourceId: id }, orderBy: { version: "asc" }, select: { version: true, status: true, snapshot: true } });
const docOf = (s: unknown) => (s as PrintedDocSnapshot).doc as unknown as OrderConfirmationDoc;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  made.customer = (await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} Müşteri` }, select: { id: true } })).id;
  made.item = (await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Tül`, itemType: "FABRIC" }, select: { id: true } })).id;
  made.color = (await prisma.color.create({ data: { code: `${TAG}-R`, name: `${TAG} Ekru` }, select: { id: true } })).id;
  let seq = 0;
  // 22:30Z = fabrika diliminde ertesi gün (UTC'ye göre basan belge bir gün geri düşer).
  const orderDate = new Date("2026-11-11T22:30:00.000Z");
  const mkOrder = async () => {
    const o = await prisma.order.create({
      data: {
        orderNumber: `${TAG}-${++seq}`, customerId: made.customer, status: "APPROVED", currency: "EUR", orderDate, deadline: new Date("2026-12-20T00:00:00.000Z"),
        totalAmount: new Prisma.Decimal("342.00"),
        lines: {
          create: [
            { itemId: made.item, colorId: made.color, quantity: new Prisma.Decimal(120), unitPrice: new Prisma.Decimal("2.85"), width: new Prisma.Decimal(300), tolerancePct: new Prisma.Decimal(5), customerItemName: "Müşteri Tül 300", cutNote: LEAK },
            { itemId: made.item, quantity: new Prisma.Decimal(80), cutNote: LEAK },
          ],
        },
      },
      select: { id: true, orderNumber: true },
    });
    made.orders.push(o.id);
    return o;
  };

  console.log("=== SİPARİŞ TEYİDİ BEKÇİSİ ===\n── §1 İçerik ──");
  const o1 = await mkOrder();
  // İptal edilmiş satır teyitte görünmez.
  await prisma.orderLine.create({ data: { orderId: o1.id, itemId: made.item, quantity: new Prisma.Decimal(999), unitPrice: new Prisma.Decimal(1), cancelledAt: new Date(), cancelReason: LEAK } });
  await printedDocumentService.getCurrent(OC, o1.id);
  const v1 = await docs(o1.id);
  const d1 = v1[0] ? docOf(v1[0].snapshot) : null;
  check("§1a ⭐ ilk açılışta v1 ACTIVE donar; belge no = sipariş no", v1.length === 1 && v1[0]!.status === "ACTIVE" && d1?.header.documentNo === o1.orderNumber, JSON.stringify(v1.map((v) => [v.version, v.status])));
  check("§1b iptal edilmiş satır yok (2 satır, 999 m yok)", d1?.lines.length === 2 && !d1.lines.some((l) => l.quantity === 999));
  // Aynı ifadede doğan iki satırın createdAt'i eşit; sıra id'ye düşer → satır miktarla seçilir.
  const L1 = d1?.lines.find((l) => l.quantity === 120), L2 = d1?.lines.find((l) => l.quantity === 80);
  check("§1c fiyatlı satır: renk, en, birim fiyat, tutar = miktar × fiyat, tolerans, müşteri adı",
    L1?.colorName === `${TAG} Ekru` && L1.widthCm === 300 && L1.unitPrice === 2.85 && L1.lineTotal === 342 && L1.tolerancePct === 5 && L1.customerItemName === "Müşteri Tül 300" && L1.itemCode === `${TAG}-I`, JSON.stringify(L1));
  check("§1d ⭐ fiyatsız satır: birim fiyat ve tutar null (0 uydurulmaz); tolerans boş → null", L2?.unitPrice === null && L2.lineTotal === null && L2.tolerancePct === null, JSON.stringify(L2));
  const raw = JSON.stringify(v1[0]?.snapshot ?? {});
  check("§1e ⭐ iç alan sızmaz (kesim notu/satır iptal sebebi metni, shippedQty, recipe, createdBy anahtarı yok)", !raw.includes(LEAK) && !/shippedQty|recipe|createdBy|cutNote/.test(raw));
  check("§1f toplam = sipariş toplamı; miktar Σ aktif satır; tarih/termin/döviz/müşteri başlıkta",
    d1?.totals.amount === 342 && d1.totals.quantity === 200 && d1.header.currency === "EUR" && d1.header.customerName === `${TAG} Müşteri` && d1.header.orderDate === orderDate.toISOString() && d1.header.deadline === "2026-12-20T00:00:00.000Z", JSON.stringify(d1?.totals));

  console.log("\n── §2 Çıktı ──");
  const html = (await printedDocumentService.getHtml(OC, o1.id)).data?.html ?? "";
  check("§2a HTML: başlık, sipariş no, sipariş tarihi FABRİKA gününde, termin takvim günü",
    html.includes("SİPARİŞ TEYİDİ") && html.includes(o1.orderNumber) && html.includes(factoryDateTr(orderDate)) && html.includes("20.12.2026"), factoryDateTr(orderDate));
  const t = (await printedDocumentService.getTables(OC, o1.id)).data as DocTablesPayload | null;
  const cols = t?.tables[0]?.columns.map((c) => c.label) ?? [];
  const htmlHasAll = cols.every((c) => html.includes(`>${c}<`));
  check("§2b ⭐ Excel tablosu HTML ile aynı kolonlar (PDF = Excel; TOL. % · BİRİM FİYAT · TUTAR dahil)", cols.length === 9 && htmlHasAll && cols.includes("TOL. %"), JSON.stringify(cols));
  const npRow = t?.tables[0]?.rows.find((r) => r[4] === 80);
  check("§2c Excel satırı: fiyatsız satır tutarı '—'", npRow?.[8] === "—", JSON.stringify(npRow));
  const snap = v1[0]!.snapshot as unknown as PrintedDocSnapshot;
  const noPrice: PrintedDocSnapshot = { ...snap, docConfigOverride: { ...(snap.docConfigOverride ?? {}), columns: { kalemler: { hidden: ["unitPrice", "amount"] } } } as PrintedDocSnapshot["docConfigOverride"] };
  const npHtml = renderOrderConfirmationHtml(noPrice);
  const npCols = renderOrderConfirmationTables(noPrice).tables[0]?.columns.map((c) => c.key) ?? [];
  check("§2d fiyatsız teyit: `columns.kalemler.hidden` → HTML ve Excel'de fiyat/tutar kolonu yok", !npHtml.includes(">BİRİM FİYAT<") && !npHtml.includes(">TUTAR<") && !npCols.includes("unitPrice") && !npCols.includes("amount"), JSON.stringify(npCols));

  console.log("\n── §5 Tasarımcı (sözleşme + Sistem eşleniği) ──");
  const contract = getContract("ORDER_CONFIRMATION");
  const paths = contractPaths(contract);
  check("§5a sözleşme kayıtlı, müşteri belgesi, `ic` sınıflı alan yok", contract.hedef === "musteri" && !Object.values(paths).some((e) => e.sinif === "ic"));
  const eq = getSystemEquivalent("ORDER_CONFIRMATION");
  check("§5b ⭐ Sistem eşleniği kayıtlı (\"Sistemden kopyala\" 409 NO_SYSTEM_EQUIVALENT vermez)", eq !== null);
  const liquid = (s: PrintedDocSnapshot): string => {
    const ayar = contract.ayarNormalize(s.docConfigOverride ?? {}) as Record<string, unknown>;
    const m = materializeEquivalent(eq!, ayar);
    const ctx = contract.insa(s, ayar, [], { baski: {} });
    return renderTemplate({ editMode: m.editMode, sourceHtml: m.html, css: m.css, pageSettings: m.pageSettings }, { context: ctx as unknown as Record<string, unknown>, snapshot: s, overlay: null }).html;
  };
  const cells = (h: string): string[] => [...h.matchAll(/<t[dh][^>]*>([^<]*)<\/t[dh]>/g)].map((x) => x[1]!.trim());
  if (eq) {
    const lq = liquid(snap);
    check("§5c ⭐ gerçek donmuş belgede Liquid tablo hücreleri = Sistem (fiyatsız satır '—', müşteri ürün adı)",
      JSON.stringify(cells(lq)) === JSON.stringify(cells(html)) && lq.includes("Müşteri Tül 300") && cells(lq).includes("—"), JSON.stringify(cells(lq)).slice(0, 160));
    const npLq = liquid(noPrice);
    check("§5d ⭐ fiyatsız teyit tasarımcı çıktısında: fiyat/tutar kolonu yok, hücreler Sistem'le aynı",
      !npLq.includes(">BİRİM FİYAT<") && !npLq.includes(">TUTAR<") && JSON.stringify(cells(npLq)) === JSON.stringify(cells(npHtml)));
    check("§5e sözleşme bağlamında iç alan metni yok (kesim notu)", !JSON.stringify(contract.insa(snap, {}, [])).includes(LEAK));
  }
  const user = await prisma.user.findFirst({ where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("Test DB'sinde kullanıcı yok (seed koşulmadı).");
  let copyCode = "";
  try {
    const r = await createTemplate({ docType: "ORDER_CONFIRMATION", name: `${TAG}-kopya`, copyFrom: { kind: "system" } }, user.id);
    made.templates.push(r.template.id);
    copyCode = r.template.copiedFrom ?? "";
  } catch (e) {
    copyCode = (e as { details?: { code?: string } }).details?.code ?? String(e);
  }
  check("§5f ⭐ \"Sistemden kopyala\" gerçek yoldan şablon doğurur (copiedFrom=system)", copyCode === "system", copyCode);

  console.log("\n── §3 Yaşam döngüsü ──");
  await prisma.orderLine.updateMany({ where: { orderId: o1.id, quantity: new Prisma.Decimal(80) }, data: { quantity: new Prisma.Decimal(90) } });
  await printedDocumentService.getCurrent(OC, o1.id);
  const again = await docs(o1.id);
  check("§3a donmuş belge sipariş değişince DEĞİŞMEZ (aynı v1, 80 m)", again.length === 1 && docOf(again[0]!.snapshot).lines.some((l) => l.quantity === 80));
  await printedDocumentService.reissue(OC, o1.id, "Miktar güncellendi");
  const re = await docs(o1.id);
  check("§3b yeniden basım: v1 SUPERSEDED, v2 ACTIVE güncel miktarla (90 m)", re.length === 2 && re[0]!.status === "SUPERSEDED" && re[1]!.status === "ACTIVE" && docOf(re[1]!.snapshot).lines.some((l) => l.quantity === 90), JSON.stringify(re.map((v) => [v.version, v.status])));
  await orderService.cancelWithActions(o1.id, [], undefined, { reasonText: "Müşteri vazgeçti" });
  const cx = await docs(o1.id);
  check("§3c ⭐ cancelWithActions: aktif belge VOIDED (sebep iptal metni)", cx[1]?.status === "VOIDED", JSON.stringify(cx.map((v) => v.status)));
  const voidReason = (await prisma.printedDocument.findFirst({ where: { docType: OC, sourceId: o1.id, version: 2 }, select: { voidReason: true } }))?.voidReason;
  check("§3d ⭐ void sebebi = iptal sebebi", voidReason === "Müşteri vazgeçti", String(voidReason));
  const o2 = await mkOrder();
  await printedDocumentService.getCurrent(OC, o2.id);
  await orderService.softDelete(o2.id);
  const sd = await docs(o2.id);
  check("§3e softDelete (genel iptal) yolu da VOIDED", sd.length === 1 && sd[0]!.status === "VOIDED", JSON.stringify(sd.map((v) => v.status)));
  const o3 = await mkOrder();
  await orderService.cancelWithActions(o3.id, [], undefined, { reasonText: "Basılmadan iptal" });
  await printedDocumentService.getCurrent(OC, o3.id);
  const born = await docs(o3.id);
  check("§3f belgesiz iptal edilmiş siparişin ilk basımı VOIDED doğar", born.length === 1 && born[0]!.status === "VOIDED", JSON.stringify(born.map((v) => v.status)));

  console.log("\n── §4 Statik ──");
  const SRC = path.join(__dirname, "..", "src");
  const routes = readFileSync(path.join(SRC, "routes/printed-document.routes.ts"), "utf8");
  check("§4a izin satırı sipariş uçlarıyla hizalı (read order:read|write · write order:write)", /ORDER_CONFIRMATION:\s*\{\s*read:\s*\["order:read", "order:write"\],\s*write:\s*\["order:write"\]/.test(routes));
  const svc = readFileSync(path.join(SRC, "services/order.service.ts"), "utf8");
  const life = readFileSync(path.join(SRC, "services/order/lifecycle.ts"), "utf8");
  check("§4b ⭐ iki iptal claim'i de void çağırır (order.service cancelWithActions · lifecycle softDelete)", /await voidOrderConfirmationTx\(tx, orderId/.test(svc) && /await voidOrderConfirmationTx\(tx, id/.test(life));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    const t = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { console.error("temizlik:", (e as Error).message); } };
    // Yayınlanmamış taslak şablon: sürüm DELETE'i trigger'ca serbest (yalnız yayınlı reddedilir).
    const verIds = (await prisma.documentTemplateVersion.findMany({ where: { templateId: { in: made.templates } }, select: { id: true } }).catch(() => [])).map((v) => v.id);
    await t(() => prisma.systemLog.deleteMany({ where: { recordId: { in: [...made.templates, ...verIds] } } }));
    await t(() => prisma.documentTemplateVersion.deleteMany({ where: { templateId: { in: made.templates } } }));
    await t(() => prisma.documentTemplate.deleteMany({ where: { id: { in: made.templates } } }));
    await t(() => prisma.printedDocument.deleteMany({ where: { docType: OC, sourceId: { in: made.orders } } }));
    await t(() => prisma.systemLog.deleteMany({ where: { recordId: { in: made.orders } } }));
    await t(() => prisma.orderLine.deleteMany({ where: { orderId: { in: made.orders } } }));
    await t(() => prisma.order.deleteMany({ where: { id: { in: made.orders } } }));
    if (made.color) await t(() => prisma.color.deleteMany({ where: { id: made.color } }));
    if (made.item) await t(() => prisma.item.deleteMany({ where: { id: made.item } }));
    if (made.customer) await t(() => prisma.customer.deleteMany({ where: { id: made.customer } }));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
