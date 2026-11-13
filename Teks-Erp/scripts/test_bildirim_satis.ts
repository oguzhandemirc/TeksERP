// =============================================================================
// BEKÇİ — BİLDİRİM S1: satış · teklif · planlama olayları + özet zamanlayıcısı + {kullanici} + K7 görünürlük
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_satis
// =============================================================================
// NEDEN: S1 türleri (geniş katalog 2026-11-14) gerçek yazma yollarına bağlı olmalı; bağ kopunca bildirim sessizce
// kesilir ve hiçbir başka bekçi bunu görmez. Ölçülenler:
//   §0 AST — her OLAY türünün `src/`de TEK `emitNotification` literali `notification-sources/satis.ts`te ve her
//      yayma fonksiyonu beklenen yazma yolu dosyasından çağrılıyor (çağrı yeri listesi aşağıda).
//   §1 DB (geri sarılan tx; global durum yazmaz) — tür başına olay → outbox satırı: gerçek yollar
//      `createWorkOrderTx` (açıldı) · `claimWorkOrderStatusTx` (başladı/tamamlandı/iptal) · `recomputeOrderStatusTx`
//      (son kalem iptali → sipariş iptal); kalanlar kaynak fonksiyonuyla. `{kullanici}` aktörden dolar, aktörsüz "Sistem".
//   §2 birleştirme anahtarı (K3): aynı tür + aynı kayıt → aynı `dedupeKey`, farklı kayıt → farklı.
//   §3 özet zamanlayıcısı: pencere hesabı (gün/saat/vardiya) + `runDigestOnce` ilk tur taban, aynı pencere
//      ikinci kez yazılmaz, yeni pencere yazılır (global ayar yazar → `finally`de birebir geri).
//   §4 K7: modül kapalıyken tür görünmez (`canSeeNotificationType`).
//   §5 `describeOrderChanges` saf sondaları.
// NEGATİF SONDA (2026-11-14): `workorder-event.helper.ts`ten `emitWorkOrderStatusTx(...)` satırı silindi ⇒
//   §0b (çağrı yeri) + §1 başladı/tamamlandı/iptal ❌ (md5 ile geri alındı).
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { Prisma, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { NOTIFICATION_CATALOG, NOTIFICATION_KINDS, type NotificationKind } from "../src/constants/notification-catalog";
import { notificationDedupeKey } from "../src/services/helpers/notification-emit.helper";
import { canSeeNotificationType } from "../src/services/helpers/notification-visibility.helper";
import { claimWorkOrderStatusTx, createWorkOrderTx } from "../src/services/helpers/workorder-event.helper";
import { recomputeOrderStatusTx } from "../src/services/helpers/order-status.helper";
import {
  describeOrderChanges, emitOrderCreatedTx, emitOrderLineCancelledTx, emitOrderTerminalTx, emitOrderUpdatedTx,
  emitQuoteEventTx, emitWorkOrderRouteChangedTx,
} from "../src/services/notification-sources/satis";
import { digestStampKey, lastClosedWindow, registeredDigestKinds, runDigestOnce } from "../src/jobs/notification-digest.job";
import { registerSalesDigestSources } from "../src/services/notification-sources/satis-ozet";
import { factoryDayStart } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const S1_OLAY = [
  "siparis.olusturuldu", "siparis.degisti", "siparis.termin-degisti", "siparis.kalem-iptal", "siparis.iptal", "siparis.tamamlandi",
  "teklif.olusturuldu", "teklif.gonderildi", "teklif.kabul", "teklif.red",
  "isemri.acildi", "isemri.baslatildi", "isemri.tamamlandi", "isemri.iptal", "isemri.rota-degisti",
] as const satisfies readonly NotificationKind[];
const S1_OZET = ["siparis.gunluk-ozet", "planlama.vardiya-ozet"] as const satisfies readonly NotificationKind[];

/** Yayma fonksiyonu → onu çağırması gereken yazma yolu dosyaları (src/ göreli). */
const CAGRI_YERLERI: Record<string, string[]> = {
  emitOrderCreatedTx: ["services/order/create.ts", "services/order/quick-order.ts"],
  emitOrderUpdatedTx: ["services/order.service.ts"],
  emitOrderLineCancelledTx: ["services/order/line-cancel.ts"],
  emitOrderTerminalTx: ["services/order.service.ts", "services/order/lifecycle.ts", "services/order/status.ts", "services/helpers/order-status.helper.ts"],
  emitQuoteEventTx: ["services/sales-quote.service.ts", "services/sales-quote-transitions.service.ts"],
  emitWorkOrderCreatedTx: ["services/helpers/workorder-event.helper.ts"],
  emitWorkOrderStatusTx: ["services/helpers/workorder-event.helper.ts"],
  emitWorkOrderRouteChangedTx: ["services/helpers/workorder-field-diff.helper.ts"],
};

// ── §0 AST ──────────────────────────────────────────────────────────────────
function bolum0(): void {
  console.log("\n§0 AST — tek yayma noktası + çağrı yerleri");
  const SRC = join(__dirname, "..", "src");
  const literaller = new Map<string, string[]>();
  const cagrilar = new Map<string, Set<string>>();
  for (const f of walkTs(SRC)) {
    const rel = relative(SRC, f).split(sep).join("/");
    const sf = ts.createSourceFile(rel, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const ad = n.expression.text;
        if (ad === "emitNotification") {
          const a = n.arguments[1];
          if (a && ts.isStringLiteral(a)) literaller.set(a.text, [...(literaller.get(a.text) ?? []), rel]);
        }
        if (ad in CAGRI_YERLERI) cagrilar.set(ad, (cagrilar.get(ad) ?? new Set()).add(rel));
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  const ihlal = S1_OLAY.filter((k) => JSON.stringify(literaller.get(k)) !== JSON.stringify(["services/notification-sources/satis.ts"]))
    .map((k) => `${k}: ${JSON.stringify(literaller.get(k) ?? [])}`);
  check("§0a ⭐ her S1 OLAY türünün TEK emit literali notification-sources/satis.ts", ihlal.length === 0, ihlal.join(" · ") || `${S1_OLAY.length} tür`);
  const eksik = Object.entries(CAGRI_YERLERI).flatMap(([fn, dosyalar]) => dosyalar.filter((d) => !cagrilar.get(fn)?.has(d)).map((d) => `${fn} ← ${d}`));
  check("§0b ⭐ her yayma fonksiyonu yazma yolundan çağrılıyor", eksik.length === 0, eksik.join(" · ") || `${Object.keys(CAGRI_YERLERI).length} fonksiyon`);
  check("§0c özet türleri katalogda `ozet` beyanlı ve emit literali yok (zamanlayıcı yazar)",
    S1_OZET.every((k) => "ozet" in NOTIFICATION_CATALOG[k] && !literaller.has(k)));
  check("§0d S1 türlerinin hepsi katalogda", [...S1_OLAY, ...S1_OZET].every((k) => NOTIFICATION_KINDS.includes(k)));
}

// ── §1–§2 DB (geri sarılan tx) ──────────────────────────────────────────────
class GeriSar extends Error {}
const ek = Date.now().toString(36);

async function bolum12(): Promise<void> {
  console.log("\n§1 olay → outbox (tek tx, sonda geri sarılır)");
  const sonuc: Array<[string, boolean, string]> = [];
  try {
    await prisma.$transaction(async (tx) => {
      const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
      const t0 = new Date(Date.now() - 1000);
      const u = await tx.user.create({ data: { username: `tbs_${ek}`, fullName: `TEST-BS Ali ${ek}`, passwordHash: "x" }, select: { id: true } });
      const cust = await tx.customer.create({ data: { code: `TEST-BS-${ek}`, name: `TEST-BS Müşteri ${ek}` }, select: { id: true } });
      const order = await tx.order.create({ data: { orderNumber: `TEST-BS-${ek}`, customerId: cust.id }, select: { id: true } });
      const order2 = await tx.order.create({ data: { orderNumber: `TEST-BS2-${ek}`, customerId: cust.id }, select: { id: true } });
      const satir = (kind: string, subjectId: string) => tx.notificationOutbox.findMany({ where: { kind, subjectId, createdAt: { gte: t0 } }, select: { payload: true, dedupeKey: true } });
      const olc = async (kind: string, subjectId: string, ek2?: (p: Record<string, unknown>) => boolean): Promise<void> => {
        const rows = await satir(kind, subjectId);
        const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
        sonuc.push([kind, rows.length === 1 && (ek2 ? ek2(p) : true), `${rows.length} satır ${JSON.stringify(p).slice(0, 120)}`]);
      };

      await emitOrderCreatedTx(tx, order.id, u.id);
      await olc("siparis.olusturuldu", order.id, (p) => p.kullanici === `TEST-BS Ali ${ek}` && p.siparisNo === `TEST-BS-${ek}`);
      await emitOrderUpdatedTx(tx, order.id, { deadline: { from: null, to: new Date("2026-12-01T09:00:00Z") }, parts: ["1 kalemde miktar"] }, u.id);
      await olc("siparis.termin-degisti", order.id, (p) => p.eskiTermin === "yok");
      await olc("siparis.degisti", order.id, (p) => p.degisiklik === "1 kalemde miktar");
      await emitOrderLineCancelledTx(tx, order.id, "Kumaş · Beyaz", u.id);
      await olc("siparis.kalem-iptal", order.id);
      await emitOrderTerminalTx(tx, order.id, "COMPLETED", null);
      await olc("siparis.tamamlandi", order.id, (p) => p.kullanici === "Sistem");
      // Gerçek yol: tek kalemli siparişin kalemi iptal → yeniden hesap CANCELLED + `siparis.iptal`.
      const item = await tx.item.create({ data: { code: `TEST-BS-${ek}`, name: `TEST-BS Kumaş ${ek}`, itemType: "FABRIC" }, select: { id: true } });
      {
        await tx.orderLine.create({ data: { orderId: order2.id, itemId: item.id, quantity: new Prisma.Decimal(10), cancelledAt: new Date() } as Prisma.OrderLineUncheckedCreateInput });
        await recomputeOrderStatusTx(tx, order2.id);
        await olc("siparis.iptal", order2.id);
      }

      const quote = await tx.salesQuote.create({
        data: { quoteNo: `TEST-BS-${ek}`.slice(0, 32), clientToken: randomUUID(), customerId: cust.id, quoteDate: new Date(), validUntilDate: new Date(Date.now() + 864e5), currency: "TRY", fxRate: new Prisma.Decimal(1), rejectReason: "fiyat" },
        select: { id: true },
      });
      await emitQuoteEventTx(tx, quote.id, "olusturuldu", u.id);
      await emitQuoteEventTx(tx, quote.id, "send", u.id);
      await emitQuoteEventTx(tx, quote.id, "accept", u.id);
      await emitQuoteEventTx(tx, quote.id, "reject", u.id);
      await olc("teklif.olusturuldu", quote.id);
      await olc("teklif.gonderildi", quote.id);
      await olc("teklif.kabul", quote.id);
      await olc("teklif.red", quote.id, (p) => p.sebep === "fiyat");

      // Gerçek yollar: doğuş + statü claim'i.
      const ctx = { trigger: "TEST_BS", userId: u.id };
      const wo = await createWorkOrderTx(tx, ctx, { data: { workOrderNumber: `TEST-BS-${ek}`, type: "STOCK_PRODUCTION", targetItemId: item.id } });
      await olc("isemri.acildi", wo.id, (p) => p.kullanici === `TEST-BS Ali ${ek}`);
      await claimWorkOrderStatusTx(tx, wo.id, { from: [WorkOrderStatus.PLANNED], to: WorkOrderStatus.IN_PROGRESS, ctx });
      await olc("isemri.baslatildi", wo.id);
      await claimWorkOrderStatusTx(tx, wo.id, { from: [WorkOrderStatus.IN_PROGRESS], to: WorkOrderStatus.COMPLETED, ctx });
      await olc("isemri.tamamlandi", wo.id);
      // Yeniden açılma başlama SAYILMAZ (COMPLETED→IN_PROGRESS).
      await claimWorkOrderStatusTx(tx, wo.id, { from: [WorkOrderStatus.COMPLETED], to: WorkOrderStatus.IN_PROGRESS, ctx });
      sonuc.push(["isemri.baslatildi yeniden açılmada yazılmaz", (await satir("isemri.baslatildi", wo.id)).length === 1, "tek satır kaldı"]);
      const wo2 = await createWorkOrderTx(tx, ctx, { data: { workOrderNumber: `TEST-BS2-${ek}`, type: "STOCK_PRODUCTION", targetItemId: item.id } });
      await claimWorkOrderStatusTx(tx, wo2.id, { from: [WorkOrderStatus.PLANNED], to: WorkOrderStatus.CANCELLED, ctx });
      await olc("isemri.iptal", wo2.id);
      await emitWorkOrderRouteChangedTx(tx, wo2.id, "Boya → Kurşun", "Boya → Tambur", u.id);
      await olc("isemri.rota-degisti", wo2.id, (p) => p.yeniRota === "Boya → Tambur");

      // §2 birleştirme: aynı tür + aynı kayıt → aynı anahtar (dağıtıcı 10 dk penceresinde tek satıra katlar).
      await emitOrderLineCancelledTx(tx, order.id, "İkinci kalem", u.id);
      const iki = await satir("siparis.kalem-iptal", order.id);
      const baska = await tx.notificationOutbox.findFirst({ where: { kind: "siparis.olusturuldu", subjectId: order.id }, select: { dedupeKey: true } });
      sonuc.push(["§2 ⭐ aynı tür + aynı kayıt iki olay → aynı dedupeKey", iki.length === 2 && iki[0]!.dedupeKey === iki[1]!.dedupeKey && iki[0]!.dedupeKey === `siparis.kalem-iptal:${order.id}`, iki.map((r) => r.dedupeKey).join(" | ")]);
      sonuc.push(["§2b farklı kayıt → farklı anahtar", notificationDedupeKey("siparis.kalem-iptal", order2.id, { siparisId: order2.id }) !== iki[0]?.dedupeKey && baska?.dedupeKey !== iki[0]?.dedupeKey, "ayrı"]);

      // Vardiya penceresi (aynı tx'te, geri sarılır).
      const def = await tx.shiftDefinition.create({ data: { code: `T${ek}`.slice(-8), name: `TEST-BS Gece ${ek}`, startMinute: 0, durationMinutes: 480 }, select: { id: true } });
      const bitis = new Date(Date.now() - 60_000);
      const inst = await tx.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: new Date(factoryDayStart(bitis).toISOString().slice(0, 10) + "T00:00:00Z"), startsAt: new Date(bitis.getTime() - 8 * 3_600_000), endsAt: bitis }, select: { id: true } });
      const w = await lastClosedWindow(tx, "VARDIYA", new Date());
      sonuc.push(["§3c vardiya penceresi = biten son vardiya örneği", w?.key === inst.id && w.label === `TEST-BS Gece ${ek}`, JSON.stringify(w)]);
      throw new GeriSar();
    });
  } catch (e) {
    if (!(e instanceof GeriSar)) throw e;
  }
  for (const [l, ok, d] of sonuc) check(l.startsWith("§") ? l : `§1 ${l}`, ok, d);
  const leftover = await prisma.order.count({ where: { orderNumber: { startsWith: `TEST-BS` }, createdAt: { gte: new Date(Date.now() - 600_000) } } });
  check("§1z geri sarma: test siparişi kalıcı değil", leftover === 0, `${leftover}`);
}

// ── §3 özet zamanlayıcısı ───────────────────────────────────────────────────
async function bolum3(): Promise<void> {
  console.log("\n§3 özet zamanlayıcısı");
  const g = await lastClosedWindow(prisma, "GUN_SONU", new Date("2026-03-15T12:00:00Z"));
  check("§3a gün sonu penceresi = biten fabrika günü (to = bugünün başı)", g?.to.getTime() === factoryDayStart(new Date("2026-03-15T12:00:00Z")).getTime() && g.to.getTime() - g.from.getTime() >= 23 * 3_600_000, JSON.stringify(g));
  const s = await lastClosedWindow(prisma, "SAATLIK", new Date("2026-03-15T12:34:00Z"));
  check("§3b saatlik pencere = biten saat (1 sa, şimdiden önce)", !!s && s.to.getTime() - s.from.getTime() === 3_600_000 && s.to.getTime() <= new Date("2026-03-15T12:34:00Z").getTime() && new Date("2026-03-15T12:34:00Z").getTime() - s.to.getTime() < 3_600_000, JSON.stringify(s));

  registerSalesDigestSources();
  check("§3d iki S1 özet kaynağı kayıtlı", S1_OZET.every((k) => registeredDigestKinds().includes(k)));
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const KIND = "siparis.gunluk-ozet";
  const keys = [SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, digestStampKey(KIND)];
  const ilk = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  const cust = await prisma.customer.create({ data: { code: `TEST-BSO-${ek}`, name: `TEST-BSO ${ek}` }, select: { id: true } });
  const NOW1 = new Date("2001-03-15T12:00:00Z");
  const NOW2 = new Date("2001-03-16T12:00:00Z");
  const gun1 = await lastClosedWindow(prisma, "GUN_SONU", NOW2); // 2001-03-15 penceresi
  const order = await prisma.order.create({ data: { orderNumber: `TEST-BSO-${ek}`, customerId: cust.id, createdAt: new Date(gun1!.from.getTime() + 3_600_000) }, select: { id: true } });
  try {
    await prisma.systemSetting.upsert({ where: { key: keys[0]! }, create: { key: keys[0]!, value: true }, update: { value: true } });
    await prisma.systemSetting.deleteMany({ where: { key: keys[1]! } });
    const r1 = await runDigestOnce(KIND, NOW1);
    const r1b = await runDigestOnce(KIND, NOW1);
    const r2 = await runDigestOnce(KIND, NOW2);
    const r2b = await runDigestOnce(KIND, NOW2);
    const rows = await prisma.notificationOutbox.findMany({ where: { kind: KIND, subjectKey: gun1!.key }, select: { id: true, payload: true } });
    check("§3e ⭐ ilk tur taban (bildirimsiz), aynı pencere ikinci kez 'already'", r1 === "baseline" && r1b === "already", `${r1}/${r1b}`);
    check("§3f ⭐ yeni pencere bir kez yazılır, tekrarı yazılmaz", r2 === "emitted" && r2b === "already" && rows.length === 1, `${r2}/${r2b} · ${rows.length} satır`);
    const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
    check("§3g özet yükü defterden sayar (yeni ≥ 1) ve tutar taşımaz", Number(p.yeni) >= 1 && !Object.keys(p).some((k) => /tutar|fiyat/i.test(k)), JSON.stringify(p));
    await prisma.notificationOutbox.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  } finally {
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.customer.delete({ where: { id: cust.id } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys } } });
    for (const row of ilk) await prisma.systemSetting.create({ data: { ...row, value: (row.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
  }
}

// ── §4 K7 + §5 saf ──────────────────────────────────────────────────────────
function bolum45(): void {
  console.log("\n§4 K7 modül kapısı · §5 değişiklik özeti");
  const viewer = { permissions: ["*"] };
  check("§4 ⭐ maliyet modülü kapalıyken teklif türü görünmez, açıkken görünür",
    !canSeeNotificationType(viewer, "teklif.kabul", { modules: { maliyetEnabled: false }, gates: {} })
    && canSeeNotificationType(viewer, "teklif.kabul", { modules: { maliyetEnabled: true }, gates: {} }));
  check("§4b üretim kapalıyken iş emri türleri görünmez",
    !canSeeNotificationType(viewer, "isemri.acildi", { modules: { productionEnabled: false }, gates: {} }));
  const cur = [{ id: "a", quantity: 10, unitPrice: 5, cancelledAt: null }, { id: "b", quantity: 3, unitPrice: null, cancelledAt: null }];
  const d = describeOrderChanges(cur, [{ id: "a", quantity: 12, unitPrice: 6 }, { quantity: 1 }], ["deadline", "notes"]);
  check("§5 ekleme · çıkarma · miktar · fiyat · başlık sayılır; termin ayrı türdür", JSON.stringify(d) === JSON.stringify(["başlık", "1 kalem eklendi", "1 kalem çıkarıldı", "1 kalemde miktar", "1 kalemde fiyat"]), JSON.stringify(d));
  check("§5b değişmeyen form kaydı boş liste", describeOrderChanges(cur, [{ id: "a", quantity: "10", unitPrice: "5" }, { id: "b", quantity: 3, unitPrice: null }], ["deadline"]).length === 0);
}

async function main(): Promise<void> {
  console.log("=== Bildirim S1 — satış · teklif · planlama ===");
  bolum0();
  bolum45();
  await bolum12();
  await bolum3();
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
