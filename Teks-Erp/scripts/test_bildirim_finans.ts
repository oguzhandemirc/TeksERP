// =============================================================================
// BEKÇİ — BİLDİRİM S4: finans · cari kart · ana veri · maliyet · yetki · cihaz olayları + çek vadesi koşulu + özet + K7
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_finans
// =============================================================================
// NEDEN: S4 türleri (geniş katalog 2026-11-14) gerçek yazma yollarına bağlı olmalı; bağ kopunca bildirim sessizce
// kesilir ve başka hiçbir bekçi görmez. Ölçülenler:
//   §0 AST — her S4 OLAY türünün `src/`de TEK `emitNotification` literali beyanlı kaynak dosyasında; her yayma
//      fonksiyonu beklenen yazma yolu dosyasından çağrılıyor; özet/koşul türlerinin literali yok; yüklerde tutar ve sır
//      alanı yok; yetki/kurşun kaynakları finans modeli okumuyor (istasyon/kullanıcı router'ı rejim kapısına bağlanmasın).
//   §1 DB (geri sarılan tx) — tür başına olay → outbox satırı, yük + `{kullanici}`; taslak fatura iptali, değişmeyen
//      yetki seti, kritik olmayan izin, PENDING olmayan cihaz ve satıcı (sistem) hesabı bildirim DOĞURMAZ.
//   §2 gerçek yol: `transitionItemLifecycle` ARCHIVED → tek `anaveri.urun-pasif`; aynı hedefe ikinci istek satır doğurmaz.
//   §3 koşul: canlı çek vade ufkunda açık, tahsil edilmiş/ufuk dışı değil; modül kapalıyken boş; özet kaynağı kayıtlı.
//   §4 K7: modül kapalıyken tür görünmez (`canSeeNotificationType`).
// NEGATİF SONDA (2026-11-14): invoice.service confirm'den `emitInvoiceConfirmedTx` silindi → §0b ❌; finans-kosul'da
//   `chequeDueLiveWhere()` where'den çıkarıldı → §3c ❌ (tahsil edilmiş çek açık sayıldı). İkisi de geri alındı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { ChequeKind, ChequeStatus, InvoiceType, PaymentDirection, PaymentMethod, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { NOTIFICATION_CATALOG, NOTIFICATION_KINDS, type NotificationKind } from "../src/constants/notification-catalog";
import { canSeeNotificationType } from "../src/services/helpers/notification-visibility.helper";
import { emitInvoiceCancelledTx, emitInvoiceConfirmedTx, emitPaymentCreatedTx } from "../src/services/notification-sources/finans";
import { emitCustomerArchivedTx, emitCustomerCardCreatedTx, emitItemArchivedTx, emitItemCreatedTx } from "../src/services/notification-sources/anaveri";
import { emitPriceListPublishedTx, emitStandardCostVersionTx } from "../src/services/notification-sources/maliyet";
import { emitKursunGramPriceChangedTx } from "../src/services/notification-sources/maliyet-kursun";
import {
  emitDevicePendingTx, emitPasswordResetTx, emitTotpResetTx, emitUserCreatedTx, emitUserDeactivatedTx, emitUserPermissionsChangedTx,
} from "../src/services/notification-sources/yetki";
import { chequeDueSubjects } from "../src/services/notification-sources/finans-kosul";
import { registerFinanceDigestSources } from "../src/services/notification-sources/finans-ozet";
import { registeredDigestKinds } from "../src/jobs/notification-digest.job";
import { transitionItemLifecycle } from "../src/services/helpers/item-lifecycle.helper";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

/** OLAY türü → tek emit literalinin kaynak dosyası (src/ göreli). */
const KAYNAK: Record<string, string> = {
  "finans.tahsilat": "finans", "finans.odeme": "finans", "finans.fatura-kesildi": "finans", "finans.fatura-iptal": "finans",
  "cari.olusturuldu": "anaveri", "cari.pasife-alindi": "anaveri", "anaveri.urun-olusturuldu": "anaveri", "anaveri.urun-pasif": "anaveri",
  "maliyet.standart-degisti": "maliyet", "maliyet.fiyat-listesi-yayinlandi": "maliyet", "maliyet.kursun-fiyat-degisti": "maliyet-kursun",
  "yetki.kullanici-olusturuldu": "yetki", "yetki.kullanici-pasif": "yetki", "yetki.yetki-degisti": "yetki", "yetki.izin-verildi": "yetki",
  "yetki.parola-sifirlandi": "yetki", "yetki.iki-adim-sifirlandi": "yetki", "cihaz.onay-bekliyor": "yetki",
};
const S4_OLAY = Object.keys(KAYNAK) as NotificationKind[];
const S4_DIGER = ["finans.cek-senet-vade", "finans.gunluk-ozet"] as const satisfies readonly NotificationKind[];

/** Yayma fonksiyonu → onu çağırması gereken yazma yolu dosyaları (src/ göreli). */
const CAGRI_YERLERI: Record<string, string[]> = {
  emitPaymentCreatedTx: ["services/payment.service.ts"],
  emitInvoiceConfirmedTx: ["services/invoice.service.ts"],
  emitInvoiceCancelledTx: ["services/invoice.service.ts"],
  emitCustomerCardCreatedTx: ["services/customer.service.ts"],
  emitCustomerArchivedTx: ["services/customer.service.ts"],
  emitItemCreatedTx: ["services/item.service.ts"],
  emitItemArchivedTx: ["services/helpers/item-lifecycle.helper.ts"],
  emitStandardCostVersionTx: ["services/standard-cost.service.ts"],
  emitPriceListPublishedTx: ["services/price-list.service.ts"],
  emitKursunGramPriceChangedTx: ["services/kursun-station.service.ts", "services/cari.service.ts"],
  emitUserCreatedTx: ["services/permission-management.service.ts"],
  emitUserDeactivatedTx: ["services/permission-management.service.ts"],
  emitUserPermissionsChangedTx: ["services/permission-management.service.ts"],
  emitPasswordResetTx: ["services/permission-management.service.ts"],
  emitTotpResetTx: ["services/totp-account.service.ts"],
  emitDevicePendingTx: ["services/device.service.ts"],
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
  const ihlal = S4_OLAY.filter((k) => JSON.stringify(literaller.get(k)) !== JSON.stringify([`services/notification-sources/${KAYNAK[k]}.ts`]))
    .map((k) => `${k}: ${JSON.stringify(literaller.get(k) ?? [])}`);
  check("§0a ⭐ her S4 OLAY türünün TEK emit literali beyanlı kaynak dosyasında", ihlal.length === 0, ihlal.join(" · ") || `${S4_OLAY.length} tür`);
  const eksik = Object.entries(CAGRI_YERLERI).flatMap(([fn, dosyalar]) => dosyalar.filter((d) => !cagrilar.get(fn)?.has(d)).map((d) => `${fn} ← ${d}`));
  check("§0b ⭐ her yayma fonksiyonu yazma yolundan çağrılıyor", eksik.length === 0, eksik.join(" · ") || `${Object.keys(CAGRI_YERLERI).length} fonksiyon`);
  check("§0c özet/koşul türlerinin emit literali yok (zamanlayıcı/tarayıcı yazar)", S4_DIGER.every((k) => !literaller.has(k)) && "ozet" in NOTIFICATION_CATALOG["finans.gunluk-ozet"]);
  check("§0d S4 türlerinin hepsi katalogda", [...S4_OLAY, ...S4_DIGER].every((k) => NOTIFICATION_KINDS.includes(k)));
  const yasak = /tutar|fiyat|bedel|bakiye|parola|sifre|pin|token|secret|totp|kod$/i;
  const yasakli = [...S4_OLAY, ...S4_DIGER].flatMap((k) => NOTIFICATION_CATALOG[k].payloadAlanlari.filter((a) => yasak.test(a) && a !== "kodlar").map((a) => `${k}.${a}`));
  check("§0e S4 yüklerinde tutar ve sır alanı yok", yasakli.length === 0, yasakli.join(" · ") || "temiz");
  const finansOkuyan = ["yetki", "maliyet-kursun", "anaveri"].filter((d) =>
    /\.(cariAccount|payment|invoice|cheque|cariTransaction)\./.test(readFileSync(join(SRC, "services/notification-sources", `${d}.ts`), "utf8")));
  check("§0f yetki/kurşun/ana veri kaynakları finans modeli okumaz (rejim kapısı)", finansOkuyan.length === 0, finansOkuyan.join(", ") || "temiz");
}

// ── §1 DB (geri sarılan tx) ─────────────────────────────────────────────────
class GeriSar extends Error {}
const ek = Date.now().toString(36);
type Sonuc = Array<[string, boolean, string]>;

async function bolum1(): Promise<void> {
  console.log("\n§1 olay → outbox (tek tx, sonda geri sarılır)");
  const sonuc: Sonuc = [];
  const sod = await prisma.permission.findFirst({ where: { code: "shipping:undo-dispatch" }, select: { id: true } });
  const sade = await prisma.permission.findFirst({ where: { code: "order:read" }, select: { id: true } });
  if (!sod || !sade) throw new Error("Fikstür eksik: izin kataloğu uzlaştırılmamış");
  try {
    await prisma.$transaction(async (tx) => {
      const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
      const t0 = new Date(Date.now() - 1000);
      const AD = `TEST-BF Ayşe ${ek}`;
      const u = await tx.user.create({ data: { username: `tbf_${ek}`, fullName: AD, passwordHash: "x" }, select: { id: true } });
      const hedef = await tx.user.create({ data: { username: `tbfh_${ek}`, fullName: `TEST-BF Hedef ${ek}`, passwordHash: "x" }, select: { id: true } });
      const sistem = await tx.user.create({ data: { username: `tbfs_${ek}`, fullName: `TEST-BF Satıcı ${ek}`, passwordHash: "x", isSystemAccount: true }, select: { id: true } });
      const satir = (kind: string, subjectId: string | null) => tx.notificationOutbox.findMany({ where: { kind, subjectId, createdAt: { gte: t0 } }, select: { payload: true } });
      const olc = async (kind: string, subjectId: string | null, kosul?: (p: Record<string, unknown>) => boolean, adet = 1, etiket = kind): Promise<void> => {
        const rows = await satir(kind, subjectId);
        const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
        sonuc.push([etiket, rows.length === adet && (adet === 0 || (kosul ? kosul(p) : p.kullanici === AD)), `${rows.length} satır ${JSON.stringify(p).slice(0, 140)}`]);
      };

      // Finans
      const CARI = `TEST-BF Müşteri ${ek}`;
      const cust = await tx.customer.create({ data: { code: `TEST-BF-${ek}`, name: CARI }, select: { id: true } });
      const cari = await tx.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust.id }, select: { id: true } });
      const box = await tx.cashBox.create({ data: { code: `TBF-${ek}`, name: `TEST-BF Kasa ${ek}` }, select: { id: true } });
      const pay = (direction: PaymentDirection, n: string) => tx.payment.create({
        data: { docNo: `TEST-BF-${n}-${ek}`, direction, method: PaymentMethod.CASH, cariId: cari.id, amount: new Prisma.Decimal(10), amountTry: new Prisma.Decimal(10), paymentDate: new Date(), cashBoxId: box.id },
        select: { id: true },
      });
      const pin = await pay(PaymentDirection.IN, "T");
      await emitPaymentCreatedTx(tx, pin.id, u.id);
      await olc("finans.tahsilat", pin.id, (p) => p.cariAd === CARI && p.yontem === "nakit" && p.kullanici === AD);
      const pout = await pay(PaymentDirection.OUT, "O");
      await emitPaymentCreatedTx(tx, pout.id, u.id);
      await olc("finans.odeme", pout.id);
      sonuc.push(["ödeme belgesi tahsilat türü doğurmaz", (await satir("finans.tahsilat", pout.id)).length === 0, "0"]);

      const inv = await tx.invoice.create({ data: { docNo: `TEST-BF-F-${ek}`, type: InvoiceType.SALES, cariId: cari.id, issueDate: new Date() }, select: { id: true } });
      await emitInvoiceConfirmedTx(tx, inv.id, u.id);
      await olc("finans.fatura-kesildi", inv.id, (p) => p.faturaTuru === "Satış" && p.cariAd === CARI);
      await emitInvoiceCancelledTx(tx, inv.id, { posted: false, reason: "taslak" }, u.id);
      await olc("finans.fatura-iptal", inv.id, undefined, 0, "finans.fatura-iptal taslak iptalinde yazılmaz");
      await emitInvoiceCancelledTx(tx, inv.id, { posted: true, reason: "yanlış cari" }, u.id);
      await olc("finans.fatura-iptal", inv.id, (p) => p.sebep === "yanlış cari");

      // Cari kart + ürün
      await emitCustomerCardCreatedTx(tx, cust.id, u.id);
      await olc("cari.olusturuldu", cust.id, (p) => p.cariAd === CARI && p.cariKodu === `TEST-BF-${ek}`);
      await emitCustomerArchivedTx(tx, cust.id, u.id);
      await olc("cari.pasife-alindi", cust.id);
      const item = await tx.item.create({ data: { code: `TEST-BF-${ek}`, name: `TEST-BF Kumaş ${ek}`, itemType: "FABRIC" }, select: { id: true } });
      await emitItemCreatedTx(tx, item.id, u.id);
      await olc("anaveri.urun-olusturuldu", item.id, (p) => p.urunKodu === `TEST-BF-${ek}`);
      await emitItemArchivedTx(tx, item.id, "kullanılmıyor", u.id);
      await olc("anaveri.urun-pasif", item.id, (p) => p.sebep === "kullanılmıyor");

      // Maliyet
      const D = (v: number) => new Prisma.Decimal(v);
      const ps = await tx.costParameterSet.create({
        data: {
          versionNo: 900_000 + Math.floor(Math.random() * 99_999), loomHourRateTry: D(1), laborHourRateTry: D(1), loomsPerOperator: D(1), energyKwhPerLoomHour: D(1),
          energyPriceTryPerKwh: D(1), overheadPct: D(1), defaultWarpWastePct: D(1), defaultWeftWastePct: D(1), defaultFabricWastePct: D(1),
          defaultEfficiencyPct: D(1), beamPrepCostTry: D(1), defaultBeamLengthM: D(1), weftSelvedgeAllowanceCm: D(1), defaultMarkupPct: D(1),
        },
        select: { id: true },
      });
      const scv = await tx.standardCostVersion.create({
        data: { itemId: item.id, versionNo: 3, parameterSetId: ps.id, rawCostPerMTry: D(1), totalCostPerMTry: D(1), warpKgPerM: D(0), weftKgPerM: D(0), fxRates: {}, inputSnapshot: {}, inputHash: "0".repeat(64), warnings: [], reason: "iplik zammı" },
        select: { id: true },
      });
      await emitStandardCostVersionTx(tx, scv.id, u.id);
      await olc("maliyet.standart-degisti", item.id, (p) => p.surumNo === 3 && p.gerekce === "iplik zammı");
      const pl = await tx.priceList.create({ data: { listNo: `TEST-BF-${ek}`, clientToken: randomUUID(), name: `TEST-BF Liste ${ek}`, currency: "TRY", customerId: cust.id }, select: { id: true } });
      await emitPriceListPublishedTx(tx, pl.id, u.id);
      await olc("maliyet.fiyat-listesi-yayinlandi", pl.id, (p) => p.musteriAd === CARI && p.listeNo === `TEST-BF-${ek}`);
      const st = await tx.station.create({ data: { code: `TBF${ek}`.slice(0, 20), name: `TEST-BF İstasyon ${ek}`, type: "INTERNAL" }, select: { id: true } });
      await emitKursunGramPriceChangedTx(tx, { kind: "station", id: st.id }, false, u.id);
      await olc("maliyet.kursun-fiyat-degisti", st.id, (p) => p.sahipTuru === "istasyonu" && p.islem === "değiştirdi");
      await emitKursunGramPriceChangedTx(tx, { kind: "cari", id: cari.id, name: CARI }, true, u.id);
      await olc("maliyet.kursun-fiyat-degisti", cari.id, (p) => p.sahipAd === CARI && p.islem === "kaldırdı");

      // Yetki
      await emitUserCreatedTx(tx, hedef.id, u.id);
      await olc("yetki.kullanici-olusturuldu", hedef.id, (p) => p.hedefKullaniciAdi === `tbfh_${ek}` && p.kullanici === AD);
      await emitUserDeactivatedTx(tx, hedef.id, u.id);
      await olc("yetki.kullanici-pasif", hedef.id);
      await emitUserPermissionsChangedTx(tx, hedef.id, { addedPermissionIds: [], removedCount: 0 }, u.id);
      await olc("yetki.yetki-degisti", hedef.id, undefined, 0, "yetki.yetki-degisti değişmeyen sette yazılmaz");
      await emitUserPermissionsChangedTx(tx, hedef.id, { addedPermissionIds: [sade.id], removedCount: 2 }, u.id);
      await olc("yetki.yetki-degisti", hedef.id, (p) => p.eklenen === 1 && p.cikarilan === 2);
      await olc("yetki.izin-verildi", hedef.id, undefined, 0, "yetki.izin-verildi kritik olmayan izinde yazılmaz");
      await emitUserPermissionsChangedTx(tx, hedef.id, { addedPermissionIds: [sod.id, sade.id], removedCount: 0 }, u.id);
      await olc("yetki.izin-verildi", hedef.id, (p) => p.kodlar === "shipping:undo-dispatch");
      await emitPasswordResetTx(tx, hedef.id, u.id);
      await olc("yetki.parola-sifirlandi", hedef.id);
      await emitTotpResetTx(tx, hedef.id, u.id);
      await olc("yetki.iki-adim-sifirlandi", hedef.id);
      await emitPasswordResetTx(tx, sistem.id, u.id);
      await emitUserCreatedTx(tx, sistem.id, u.id);
      const sis = (await satir("yetki.parola-sifirlandi", sistem.id)).length + (await satir("yetki.kullanici-olusturuldu", sistem.id)).length;
      sonuc.push(["satıcı (sistem) hesabı bildirim doğurmaz", sis === 0, `${sis}`]);

      // Cihaz
      await emitDevicePendingTx(tx, { name: "Onaylı", kind: "TABLET", status: "APPROVED" });
      await emitDevicePendingTx(tx, { name: `TEST-BF Tablet ${ek}`, kind: "TABLET", status: "PENDING" });
      const cih = await tx.notificationOutbox.findMany({ where: { kind: "cihaz.onay-bekliyor", createdAt: { gte: t0 } }, select: { payload: true, subjectKey: true } });
      const cp = (cih[0]?.payload ?? {}) as Record<string, unknown>;
      sonuc.push(["cihaz.onay-bekliyor yalnız PENDING doğuşta, sabit kalıp", cih.length === 1 && cp.cihazTuru === "tablet" && cih[0]!.subjectKey === "onay-bekleyen-cihaz", JSON.stringify(cih)]);
      throw new GeriSar();
    });
  } catch (e) {
    if (!(e instanceof GeriSar)) throw e;
  }
  for (const [l, ok, d] of sonuc) check(`§1 ${l}`, ok, d);
  const kalinti = await prisma.customer.count({ where: { code: `TEST-BF-${ek}` } });
  check("§1y geri sarma: test kartı kalıcı değil", kalinti === 0, `${kalinti}`);
}

// ── §2 gerçek yol: ürün yaşam döngüsü ───────────────────────────────────────
async function bolum2(): Promise<void> {
  console.log("\n§2 gerçek yol — transitionItemLifecycle ARCHIVED → anaveri.urun-pasif");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key } });
  const item = await prisma.item.create({ data: { code: `TEST-BF2-${ek}`, name: `TEST-BF2 ${ek}`, itemType: "FABRIC" }, select: { id: true } });
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    const r1 = await transitionItemLifecycle({ itemId: item.id, to: "ARCHIVED", reason: "TEST pasif", userId: null });
    const r2 = await transitionItemLifecycle({ itemId: item.id, to: "ARCHIVED", reason: "TEST tekrar", userId: null });
    const rows = await prisma.notificationOutbox.findMany({ where: { kind: "anaveri.urun-pasif", subjectId: item.id }, select: { id: true, payload: true } });
    const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
    check("§2a ⭐ gerçek geçiş tek outbox satırı yazar", !r1.idempotent && rows.length === 1 && p.sebep === "TEST pasif", `${rows.length} satır ${JSON.stringify(p)}`);
    check("§2b hedef durumdaki ikinci istek (idempotent) satır doğurmaz", r2.idempotent && rows.length === 1);
    await prisma.notificationOutbox.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  } finally {
    await prisma.item.delete({ where: { id: item.id } });
    if (ilk) await prisma.systemSetting.update({ where: { key }, data: { value: (ilk.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

// ── §3 koşul + özet ─────────────────────────────────────────────────────────
async function bolum3(): Promise<void> {
  console.log("\n§3 çek/senet vadesi koşulu + özet kaydı");
  registerFinanceDigestSources();
  check("§3a finans gün sonu özeti kayıtlı", registeredDigestKinds().includes("finans.gunluk-ozet"));
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const cust = await prisma.customer.create({ data: { code: `TEST-BF3-${ek}`, name: `TEST-BF3 Müşteri ${ek}` }, select: { id: true } });
  const ids: string[] = [];
  try {
    const cari = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust.id }, select: { id: true } });
    const now = new Date();
    const cek = async (n: string, gunSonra: number, status: ChequeStatus) => {
      const c = await prisma.cheque.create({
        data: {
          docNo: `TEST-BF3-${n}-${ek}`, kind: ChequeKind.RECEIVED, status, cariId: cari.id, amount: new Prisma.Decimal(5), amountTry: new Prisma.Decimal(5),
          issueDate: now, postingDate: now, dueDate: new Date(now.getTime() + gunSonra * 86_400_000),
        },
        select: { id: true },
      });
      ids.push(c.id);
      return c.id;
    };
    const yakin = await cek("Y", 1, ChequeStatus.PORTFOLIO);
    const gecmis = await cek("G", -5, ChequeStatus.AT_BANK);
    const uzak = await cek("U", 40, ChequeStatus.PORTFOLIO);
    const tahsil = await cek("T", 1, ChequeStatus.COLLECTED);
    const acik = new Set((await chequeDueSubjects(now, async () => true)).map((s) => s.key));
    check("§3b ⭐ ufuktaki ve vadesi geçmiş canlı belge açık", acik.has(yakin) && acik.has(gecmis), `${acik.has(yakin)}/${acik.has(gecmis)}`);
    check("§3c ufuk dışı ve tahsil edilmiş belge açık değil (canlı küme tek kaynaktan)", !acik.has(uzak) && !acik.has(tahsil));
    check("§3d modül kapalıyken koşul boş", (await chequeDueSubjects(now, async () => false)).length === 0);
  } finally {
    await prisma.cheque.deleteMany({ where: { id: { in: ids } } });
    await cleanupTestCustomers([cust.id]);
  }
}

// ── §4 K7 ───────────────────────────────────────────────────────────────────
function bolum4(): void {
  console.log("\n§4 K7 modül kapısı");
  const viewer = { permissions: ["*"] };
  const kapali = (kind: NotificationKind, modul: string) => !canSeeNotificationType(viewer, kind, { modules: { [modul]: false }, gates: {} })
    && canSeeNotificationType(viewer, kind, { modules: { [modul]: true }, gates: {} });
  check("§4a ⭐ finans kapalıyken finans.* görünmez", (["finans.tahsilat", "finans.fatura-iptal", "finans.cek-senet-vade", "finans.gunluk-ozet"] as const).every((k) => kapali(k, "financeEnabled")));
  check("§4b maliyet kapalıyken standart maliyet / fiyat listesi görünmez", kapali("maliyet.standart-degisti", "maliyetEnabled") && kapali("maliyet.fiyat-listesi-yayinlandi", "maliyetEnabled"));
}

async function main(): Promise<void> {
  console.log("=== Bildirim S4 — finans · cari · ana veri · maliyet · yetki · cihaz ===");
  bolum0();
  bolum4();
  await bolum1();
  await bolum2();
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
