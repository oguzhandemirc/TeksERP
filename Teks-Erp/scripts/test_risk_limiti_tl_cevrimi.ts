// =============================================================================
// BEKÇİ — RİSK LİMİTİ PARA BİRİMİ KİPİ (D4-I2b; kullanıcı kararı S12, DALGA4 §10.5 md. 5, §14 S12)
// =============================================================================
//   §0 statik — kip `riskExposureTx`in İÇİNDE okunur (ikinci exposure fonksiyonu yok — o `test_risk_limiti_kapilar`
//      §0b'de); kur okuması FOR UPDATE'ten SONRA ve TEK kaynaktan (`resolveExchangeRateTx`)
//   §1 PER_CURRENCY (ayar yazılmamış) — para birimleri AYRI ölçülür, `converted` false
//   §2 TRY_CONVERTED — limit 100.000 TL, bakiye 60.000 TL + 1.000 USD (kur 34) → 94.000 geçer; +7.000 TL fatura →
//      409 RISK_LIMIT_EXCEEDED (TL metni); USD eki de TL'ye çevrilir
//   §3 kur yok (USD kurları geri sarılan tx'te silinir) → 409 RISK_LIMIT_FX_MISSING, Türkçe ekran yolu
//   §4 bilinmeyen ayar değeri 400 (servis + Zod)
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): ① `converted` ayar okunmadan `false` sabitine bağlandı → §2a/§2b/§2c/§3a ❌;
//    ② shipping.service'e ikinci exposure hesabı eklendi → `test_risk_limiti_kapilar` §0b ❌. Geri alındı.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { invoiceService } from "../src/services/invoice.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { assertCustomerRiskLimitTx, riskExposureTx } from "../src/services/helpers/risk-exposure.helper";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
async function hataNesnesi(fn: () => Promise<unknown>): Promise<{ kod: string; mesaj: string }> {
  try {
    await fn();
    return { kod: "geçti", mesaj: "" };
  } catch (e) {
    const d = (e as { details?: { code?: string } }).details;
    return { kod: String(d?.code ?? (e as Error).message ?? e), mesaj: (e as Error).message ?? "" };
  }
}
class Rollback extends Error {}
/** Geri sarılan tx: fn'in sonucu ya da hatası döner, yazımlar kalıcı olmaz. */
async function geriSarilan<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<{ kod: string; mesaj: string; deger?: T }> {
  let deger: T | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      deger = await fn(tx);
      throw new Rollback();
    }, { timeout: 60_000 });
    return { kod: "yazdı?!", mesaj: "" };
  } catch (e) {
    if (e instanceof Rollback) return { kod: "geçti", mesaj: "", deger };
    return hataNesnesi(() => Promise.reject(e));
  }
}

const SRC = path.resolve(__dirname, "..", "src");
const TAG = `TEST-RLT-${process.pid}`;
const AYARLAR = [
  SETTING_KEYS.FINANCE_ENABLED,
  SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_ENABLED,
  SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_INTAKE,
  SETTING_KEYS.FINANCE_RISK_LIMIT_CURRENCY_MODE,
];

function statik(): void {
  console.log("── §0 Statik ──");
  const helper = readFileSync(path.join(SRC, "services/helpers/risk-exposure.helper.ts"), "utf8");
  const i = helper.indexOf("export async function riskExposureTx(");
  const govde = helper.slice(i, helper.indexOf("\n}\n", i));
  const modOku = govde.indexOf("readFinanceRiskLimitCurrencyMode(tx)");
  const kilit = govde.indexOf("FOR UPDATE");
  const kur = govde.indexOf("toTryOrFail(");
  check("§0a kip çekirdeğin İÇİNDE okunur (kilitten önce, ayar okuması)", modOku > 0 && modOku < kilit, `ayar@${modOku} kilit@${kilit}`);
  check("§0b kur okuması FOR UPDATE'ten SONRA", kur > kilit, `kilit@${kilit} kur@${kur}`);
  check("§0c kur TEK kaynaktan (`resolveExchangeRateTx`), helper kendi kur sorgusunu yazmaz", helper.includes("resolveExchangeRateTx(tx, currency, onDate)") && !/exchangeRate\.(find|aggregate)/.test(helper));
  check("§0d kur günü fabrika gününden (`factoryDayKeyUtcMidnight`)", /const onDate = factoryDayKeyUtcMidnight\(\)/.test(govde));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== RİSK LİMİTİ PARA BİRİMİ KİPİ BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const ayar = (key: string, v: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  const bugun = factoryDayKeyUtcMidnight();
  const eskiKur = await prisma.exchangeRate.findUnique({ where: { rateDate_currency: { rateDate: bugun, currency: "USD" } } });
  const admin = await ensureTestAdmin();
  const ids = { customers: [] as string[], invoices: [] as string[] };
  try {
    await ayar(SETTING_KEYS.FINANCE_ENABLED, true);
    await ayar(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_ENABLED, true);
    await ayar(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_INTAKE, true);
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_RISK_LIMIT_CURRENCY_MODE } });
    await prisma.exchangeRate.upsert({ where: { rateDate_currency: { rateDate: bugun, currency: "USD" } }, create: { rateDate: bugun, currency: "USD", rate: 34 }, update: { rate: 34 } });

    const r = (await customerService.create({ name: `${TAG} A`, isCustomerRole: true }, admin.id)) as { data: { id: string } };
    ids.customers.push(r.data.id);
    const customerId = r.data.id;
    const acc = await prisma.cariAccount.findFirstOrThrow({ where: { customerId }, select: { id: true } });
    const cariId = acc.id;
    await prisma.cariAccount.update({ where: { id: cariId }, data: { riskLimit: 100000 } });
    const bakiye = (currency: "TRY" | "USD", balance: number) =>
      prisma.cariBalance.upsert({ where: { cariId_currency: { cariId, currency } }, create: { cariId, currency, balance }, update: { balance } });
    await bakiye("TRY", 60000);
    await bakiye("USD", 1000);
    const D = (n: number) => new Prisma.Decimal(n);

    // ── §1 PER_CURRENCY (ayar yok = bugünkü davranış) ──
    console.log("\n── §1 PER_CURRENCY (varsayılan) ──");
    const p1 = await geriSarilan((tx) => riskExposureTx(tx, cariId, null, D(0)));
    const satir1 = (p1.deger ?? []).map((e) => `${e.currency}:${e.balance.toFixed(0)}:${e.converted}`).join(",");
    check("§1a para birimleri AYRI (TRY 60000 · USD 1000), çevrim yok", satir1 === "TRY:60000:false,USD:1000:false", satir1);
    const p2 = await geriSarilan((tx) => riskExposureTx(tx, cariId, "TRY", D(41000)));
    check("§1b TRY satırı + 41.000 ek → aşım (yalnız TRY ölçülür)", p2.deger?.length === 1 && p2.deger[0].exceeded && p2.deger[0].exposure.eq(101000));
    check("§1c kapı geçer (her para birimi limit altında)", (await hataNesnesi(() => assertCustomerRiskLimitTx(prisma, customerId, "INTAKE"))).kod === "geçti");

    // ── §2 TRY_CONVERTED ──
    console.log("\n── §2 TRY_CONVERTED ──");
    await systemSettingService.setFeatureFlags({ financeRiskLimitCurrencyMode: "TRY_CONVERTED" }, admin.id);
    const t1 = await geriSarilan((tx) => riskExposureTx(tx, cariId, null, D(0)));
    const e1 = t1.deger?.[0];
    check("§2a ⭐ 60.000 TL + 1.000 USD × 34 = 94.000 TL tek satır, aşım yok", t1.deger?.length === 1 && e1?.currency === "TRY" && e1.converted && e1.balance.eq(94000) && !e1.exceeded, `${t1.kod} ${e1?.balance?.toFixed(2)}`);
    check("§2b iş kabulü kapısı geçer (94.000 < 100.000)", (await hataNesnesi(() => assertCustomerRiskLimitTx(prisma, customerId, "INTAKE"))).kod === "geçti");
    const satir = [{ description: `${TAG} hizmet`, qty: 10, unit: "m", unitPrice: 700, vatRate: 0 }];
    const f1 = (await invoiceService.createDraft({ type: "SALES", customerId, currency: "TRY", lines: satir }, admin.id)).data!;
    ids.invoices.push(f1.id);
    const c2 = await hataNesnesi(() => invoiceService.confirm(f1.id, admin.id));
    check(
      "§2c ⭐ +7.000 TL fatura → 409 RISK_LIMIT_EXCEEDED (TL toplamı)",
      c2.kod === "RISK_LIMIT_EXCEEDED" && c2.mesaj.includes("limit 100000.00 TRY, mevcut bakiye 94000.00 (TL'ye çevrilmiş toplam), bu fatura 7000.00 → toplam 101000.00"),
      c2.mesaj,
    );
    const t2 = await geriSarilan((tx) => riskExposureTx(tx, cariId, "USD", D(100)));
    check("§2d USD eki de TL'ye çevrilir (100 USD = 3.400 TL → 97.400)", t2.deger?.[0]?.extra.eq(3400) === true && t2.deger[0].exposure.eq(97400), t2.kod);
    await bakiye("TRY", 67000);
    const g2 = await hataNesnesi(() => assertCustomerRiskLimitTx(prisma, customerId, "INTAKE"));
    check("§2e kapı 409 RISK_LIMIT_EXCEEDED, metin 'TL'ye çevrilmiş toplam'", g2.kod === "RISK_LIMIT_EXCEEDED" && g2.mesaj.includes("TL'ye çevrilmiş toplam bakiye limitin üstünde"), g2.mesaj);
    await bakiye("TRY", 60000);

    // ── §3 Kur yok → FAIL-CLOSED ──
    console.log("\n── §3 Kur yok ──");
    const k1 = await geriSarilan(async (tx) => {
      await tx.exchangeRate.deleteMany({ where: { currency: "USD" } });
      return assertCustomerRiskLimitTx(tx, customerId, "INTAKE");
    });
    check("§3a ⭐ USD kuru yok → 409 RISK_LIMIT_FX_MISSING, Türkçe ekran yolu", k1.kod === "RISK_LIMIT_FX_MISSING" && k1.mesaj.startsWith("USD için güncel kur yok; Ön Muhasebe → Kurlar ekranından girin."), k1.mesaj);
    const k2 = await geriSarilan(async (tx) => {
      await tx.exchangeRate.deleteMany({ where: { currency: "USD" } });
      await tx.cariBalance.update({ where: { cariId_currency: { cariId, currency: "USD" } }, data: { balance: 0 } });
      return riskExposureTx(tx, cariId, null, D(0));
    });
    check("§3b sıfır USD bakiyesinde kur aranmaz (geçer, 60.000)", k2.kod === "geçti" && k2.deger?.[0]?.balance.eq(60000) === true, k2.mesaj);

    // ── §4 Ayar doğrulama ──
    console.log("\n── §4 Ayar doğrulama ──");
    const v1 = await hataNesnesi(() => systemSettingService.setFeatureFlags({ financeRiskLimitCurrencyMode: "EUR_CONVERTED" } as never, admin.id));
    check("§4a servis: bilinmeyen değer 400", /financeRiskLimitCurrencyMode şunlardan biri olmalı/.test(v1.mesaj), v1.mesaj);
    check("§4b Zod: bilinmeyen değer reddedilir, iki değer kabul", !updateSchema.safeParse({ financeRiskLimitCurrencyMode: "X" }).success && updateSchema.safeParse({ financeRiskLimitCurrencyMode: "PER_CURRENCY" }).success);
    const okunan = (await systemSettingService.getFeatureFlags()).data?.financeRiskLimitCurrencyMode;
    check("§4c okuma yüzeyi TRY_CONVERTED döner", okunan === "TRY_CONVERTED", String(okunan));
  } finally {
    await temizle(ids).catch((e) => {
      fail++;
      console.log(`❌ temizlik — ${String(e).slice(0, 300)}`);
    });
    if (eskiKur) await prisma.exchangeRate.update({ where: { id: eskiKur.id }, data: { rate: eskiKur.rate } });
    else await prisma.exchangeRate.deleteMany({ where: { rateDate: bugun, currency: "USD" } });
    for (const key of AYARLAR) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(ids: { customers: string[]; invoices: string[] }): Promise<void> {
  const accIds = (await prisma.cariAccount.findMany({ where: { customerId: { in: ids.customers } }, select: { id: true } })).map((a) => a.id);
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.invoices, ...ids.customers, ...accIds] } } });
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: ids.invoices } } });
  await prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
