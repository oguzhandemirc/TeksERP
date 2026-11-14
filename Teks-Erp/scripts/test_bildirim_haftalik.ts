// =============================================================================
// BEKÇİ — BİLDİRİM S5a: haftalık özet penceresi + `fason.haftalik-ozet` · `finans.haftalik-ozet`
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_haftalik
// =============================================================================
// NEDEN: haftalık özet (kullanıcı kararı 2026-11-14) günlük özetlerin YANINA gelir; pencere fabrika diliminde
// Pazartesi 00:00 → Pazartesi 00:00'dır. Kenar bir ms kayarsa Pazar gecesi işi yanlış haftaya yazılır, dilim
// UTC'ye düşerse Türkiye'de Pazartesi 00:00–03:00 arası önceki haftada kalır. Ölçülenler:
//   §0 katalog — iki tür `ozet: "HAFTALIK"`, emit literali yok (zamanlayıcı yazar), yükte tutar yok, görünürlük
//      (modül + izin) günlük ikiziyle AYNI, günlük ikizler hâlâ `GUN_SONU`.
//   §1 pencere — İstanbul'da Pazartesi 00:00 kenarı (−1 ms önceki hafta, tam an yeni hafta), hafta ortası, etiket;
//      DST'li dilimde (Europe/Berlin, 2026-10-25 geri alma) hafta 7 gün + 1 saat ve iki uç yerel 00:00.
//   §2 DB — kayıt; ilk tur taban, kapanan hafta bir kez yazılır, tekrar `already`; sayım pencere kenarına uyar
//      (from dahil, to hariç) ve günlük/haftalık özet aynı sayım fonksiyonundan gelir.
// NEGATİF SONDA (2026-11-14): `lastClosedWeek` hedef günü 1 → 0 (Pazar) yapıldı ⇒ §1a/§1b/§1c/§1d ❌;
//   `registerFinanceDigestSources`ten haftalık kayıt silindi ⇒ §2a ❌ ve §2 finans turu fırlattı (geri alındı, md5 eşit).
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { PaymentDirection, PaymentMethod, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { NOTIFICATION_CATALOG, type NotificationKind } from "../src/constants/notification-catalog";
import { DEFAULT_FACTORY_TIMEZONE, applyFactoryTimezone, factoryYmd, getFactoryBaseTimezone, getFactoryTimezonePeriods } from "../src/constants/time";
import { digestStampKey, lastClosedWindow, registeredDigestKinds, runDigestOnce } from "../src/jobs/notification-digest.job";
import { registerDepotDigestSources } from "../src/services/notification-sources/depo-ozet";
import { registerFinanceDigestSources } from "../src/services/notification-sources/finans-ozet";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const HAFTALIK = ["fason.haftalik-ozet", "finans.haftalik-ozet"] as const satisfies readonly NotificationKind[];
const IKIZ: Record<(typeof HAFTALIK)[number], NotificationKind> = { "fason.haftalik-ozet": "fason.gunluk-ozet", "finans.haftalik-ozet": "finans.gunluk-ozet" };
const ek = Date.now().toString(36);

// ── §0 katalog ──────────────────────────────────────────────────────────────
function bolum0(): void {
  console.log("\n§0 katalog");
  const SRC = join(__dirname, "..", "src");
  const literaller = new Set<string>();
  for (const f of walkTs(SRC)) {
    const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "emitNotification") {
        const a = n.arguments[1];
        if (a && ts.isStringLiteral(a)) literaller.add(a.text);
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  check("§0a ⭐ iki tür `ozet: HAFTALIK`, emit literali yok (zamanlayıcı yazar)", HAFTALIK.every((k) => NOTIFICATION_CATALOG[k].ozet === "HAFTALIK" && !literaller.has(k)));
  check("§0b yükte tutar alanı yok; yer tutucu `hafta`", HAFTALIK.every((k) => !NOTIFICATION_CATALOG[k].payloadAlanlari.some((a) => /tutar|fiyat|bedel/i.test(a)) && NOTIFICATION_CATALOG[k].payloadAlanlari.includes("hafta")));
  check("§0c görünürlük (modül + izin + grup) günlük ikiziyle aynı", HAFTALIK.every((k) => {
    const h = NOTIFICATION_CATALOG[k];
    const g = NOTIFICATION_CATALOG[IKIZ[k]];
    return h.modul === g.modul && JSON.stringify(h.izinler) === JSON.stringify(g.izinler) && h.grup === g.grup;
  }));
  check("§0d günlük ikizler kalır (`GUN_SONU`)", HAFTALIK.every((k) => (NOTIFICATION_CATALOG[IKIZ[k]] as { ozet?: string }).ozet === "GUN_SONU"));
}

// ── §1 pencere ──────────────────────────────────────────────────────────────
async function hafta(now: Date) {
  const w = await lastClosedWindow(prisma, "HAFTALIK", now);
  if (!w) throw new Error("haftalık pencere null");
  return w;
}

async function bolum1(): Promise<void> {
  console.log("\n§1 haftalık pencere (fabrika dilimi)");
  const onceki = getFactoryBaseTimezone();
  if (getFactoryTimezonePeriods().length > 1) throw new Error("bekçi dönemli dilimle başlatıldı — geri yükleme tek dilim varsayar");
  try {
    applyFactoryTimezone(DEFAULT_FACTORY_TIMEZONE); // İstanbul (UTC+3, DST yok) — beklenen anlar buna göre
    // 2026-11-16 Pazartesi 00:00 İstanbul = 2026-11-15T21:00:00Z.
    const PZT = new Date("2026-11-15T21:00:00.000Z");
    const tam = await hafta(PZT);
    check("§1a ⭐ Pazartesi 00:00 tam an: biten hafta 09–15 Kasım",
      tam.key === "2026-11-09" && tam.from.toISOString() === "2026-11-08T21:00:00.000Z" && tam.to.getTime() === PZT.getTime(), `${tam.key} ${tam.from.toISOString()} → ${tam.to.toISOString()}`);
    const once = await hafta(new Date(PZT.getTime() - 1));
    check("§1b ⭐ Pazar 23:59:59.999: hâlâ önceki hafta (02–08 Kasım)", once.key === "2026-11-02" && once.to.toISOString() === "2026-11-08T21:00:00.000Z", once.key);
    const gece = await hafta(new Date("2026-11-15T23:30:00.000Z")); // Pzt 02:30 yerel, UTC'de hâlâ Pazar
    check("§1c Pazartesi 02:30 yerel (UTC'de Pazar) yeni haftayı görür", gece.key === "2026-11-09", gece.key);
    const orta = await hafta(new Date("2026-11-19T09:00:00.000Z"));
    check("§1d hafta ortası: biten hafta 09–15 Kasım, etiket iki uç gün", orta.key === "2026-11-09" && orta.label === "2026-11-09 – 2026-11-15", orta.label);
    applyFactoryTimezone("Europe/Berlin");
    // 2026-10-25 Pazar 03:00 CEST → 02:00 CET (geri alma); hafta 19–25 Ekim 169 saat.
    const dst = await hafta(new Date("2026-10-27T10:00:00.000Z"));
    const saat = (dst.to.getTime() - dst.from.getTime()) / 3_600_000;
    check("§1e DST'li dilimde hafta yerel 00:00 → 00:00 (169 saat)",
      dst.key === "2026-10-19" && dst.from.toISOString() === "2026-10-18T22:00:00.000Z" && dst.to.toISOString() === "2026-10-25T23:00:00.000Z" && saat === 169,
      `${dst.from.toISOString()} → ${dst.to.toISOString()} (${saat} sa)`);
    check("§1f Berlin'de pencere sonu yerel Pazartesi", factoryYmd(dst.to) === "2026-10-26");
  } finally {
    applyFactoryTimezone(onceki);
  }
}

// ── §2 DB ───────────────────────────────────────────────────────────────────
async function bolum2(): Promise<void> {
  console.log("\n§2 özet turları (DB)");
  registerDepotDigestSources();
  registerFinanceDigestSources();
  check("§2a ⭐ iki haftalık + iki günlük kaynak kayıtlı", [...HAFTALIK, ...Object.values(IKIZ)].every((k) => registeredDigestKinds().includes(k)), registeredDigestKinds().join(","));
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const NOW1 = new Date("2001-04-11T12:00:00Z"); // Çarşamba → biten hafta 02–08 Nisan (taban)
  const NOW2 = new Date("2001-04-16T12:00:00Z"); // Pazartesi → biten hafta 09–15 Nisan
  const w = await hafta(NOW2);
  const keys = [SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, ...HAFTALIK.map(digestStampKey)];
  const ilk = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  const firma = await ensureTestDyeHouse();
  const item = await prisma.item.create({ data: { code: `TEST-BHF-${ek}`, name: `TEST-BHF ${ek}`, itemType: "FABRIC" }, select: { id: true } });
  const cust = await prisma.customer.create({ data: { code: `TEST-BHF-${ek}`, name: `TEST-BHF ${ek}` }, select: { id: true } });
  const ids = { wv: [] as string[], sd: [] as string[], pay: [] as string[], cari: "", box: "" };
  try {
    const sayFason = () => prisma.subcontractorDispatch.count({ where: { cancelledAt: null, dispatchedAt: { gte: w.from, lt: w.to } } });
    const sayTahsilat = () => prisma.payment.count({ where: { direction: PaymentDirection.IN, createdAt: { gte: w.from, lt: w.to } } });
    const zeminFason = await sayFason();
    const zeminTahsilat = await sayTahsilat();
    // Kenar sondası: from (dahil) · to − 1 ms (dahil) · from − 1 ms (hariç) · to (hariç).
    const anlar = [w.from, new Date(w.to.getTime() - 1), new Date(w.from.getTime() - 1), w.to];
    for (const [i, at] of anlar.entries()) {
      const wv = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `TEST-BHF-${i}-${ek}`, itemId: item.id, executionKind: "SUBCONTRACTED", subcontractorId: firma.id }, select: { id: true } });
      ids.wv.push(wv.id);
      const sd = await prisma.subcontractorDispatch.create({ data: { dispatchNo: `TEST-BHF-${i}-${ek}`, subcontractorId: firma.id, weavingOrderId: wv.id, totalQty: new Prisma.Decimal(100), dispatchedAt: at }, select: { id: true } });
      ids.sd.push(sd.id);
    }
    const cari = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust.id }, select: { id: true } });
    ids.cari = cari.id;
    const box = await prisma.cashBox.create({ data: { code: `TBHF-${ek}`, name: `TEST-BHF Kasa ${ek}` }, select: { id: true } });
    ids.box = box.id;
    for (const [i, at] of anlar.entries()) {
      const p = await prisma.payment.create({
        data: { docNo: `TEST-BHF-${i}-${ek}`, direction: PaymentDirection.IN, method: PaymentMethod.CASH, cariId: cari.id, amount: new Prisma.Decimal(10), amountTry: new Prisma.Decimal(10), paymentDate: at, cashBoxId: box.id, createdAt: at },
        select: { id: true },
      });
      ids.pay.push(p.id);
    }
    check("§2b kenar fikstürü: pencere içi 2, dışı 2 (doğrudan sayım)", (await sayFason()) - zeminFason === 2 && (await sayTahsilat()) - zeminTahsilat === 2);

    await prisma.systemSetting.upsert({ where: { key: keys[0]! }, create: { key: keys[0]!, value: true }, update: { value: true } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys.slice(1) } } });
    for (const kind of HAFTALIK) {
      const r1 = await runDigestOnce(kind, NOW1);
      const r2 = await runDigestOnce(kind, NOW2);
      const r3 = await runDigestOnce(kind, new Date(NOW2.getTime() + 86_400_000)); // Salı: aynı hafta
      const rows = await prisma.notificationOutbox.findMany({ where: { kind, subjectKey: w.key }, select: { id: true, payload: true } });
      const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
      check(`§2c ⭐ ${kind}: taban → bir kez yazılır → aynı hafta tekrar yazılmaz`, r1 === "baseline" && r2 === "emitted" && r3 === "already" && rows.length === 1, `${r1}/${r2}/${r3} · ${rows.length}`);
      const sayiOk = kind === "fason.haftalik-ozet"
        ? Number(p.cikis) === zeminFason + 2 && Number(p.cikisMetre) >= 200
        : Number(p.tahsilat) === zeminTahsilat + 2;
      check(`§2d ⭐ ${kind}: sayım kenara uyar (from dahil, to hariç), etiket hafta`, sayiOk && p.hafta === w.label && !("gun" in p), JSON.stringify(p));
      check(`§2e ${kind}: yükte tutar yok`, !Object.keys(p).some((a) => /tutar|amount|fiyat/i.test(a)));
      await prisma.notificationOutbox.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    }
  } finally {
    await prisma.payment.deleteMany({ where: { id: { in: ids.pay } } });
    if (ids.box) await prisma.cashBox.delete({ where: { id: ids.box } });
    if (ids.cari) await prisma.cariAccount.delete({ where: { id: ids.cari } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.sd } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: ids.wv } } });
    await prisma.customer.delete({ where: { id: cust.id } });
    await prisma.item.delete({ where: { id: item.id } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys } } });
    for (const row of ilk) await prisma.systemSetting.create({ data: { ...row, value: (row.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
  }
}

async function main(): Promise<void> {
  console.log("=== Bildirim S5a — haftalık özet ===");
  bolum0();
  await bolum1();
  await bolum2();
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
