// =============================================================================
// RİSK LİMİTİ — TEK ÇEKİRDEK (D4-I2; tasarım DALGA4 §10.5 md. 5, K24)
// =============================================================================
// "Carinin riski limiti aşıyor mu" hesabı YALNIZ `riskExposureTx`te yapılır: satış faturası onayı
// (`InvoiceService.assertRiskLimitTx`, ek = fatura tutarı) ile iş kabulü / sevk kapısı (`assertCustomerRiskLimitTx`,
// ek = 0) aynı çekirdeği çağırır. İkinci bir hesap yazmak `test_risk_limiti_kapilar` §0'da kırmızıdır.
//
// ⚠️ KİLİT SIRASI: bakiye satırı `cari_balances` FOR UPDATE ile okunur (artırımlı yazımla yarış — fatura emsali).
// Fatura onayında çağrı dönem guard'ının advisory kilidinden SONRADIR; sevk tx'i advisory 8026 almaz, sıra
// "bakiye → sevkiyat satırı" fatura onayıyla aynıdır. Yeni kilit uzayı açılmaz.
// ⚠️ `riskLimit` PARA BİRİMİ TAŞIMAZ. Kip ayardan (S12, D4-I2b): `PER_CURRENCY` (varsayılan) her para birimindeki bakiye
// limitle AYRI ölçülür (fatura ilkesi); `TRY_CONVERTED` limit TL sayılır, carinin TÜM bakiyeleri + ek tutar fabrika
// gününün kuruyla (`resolveExchangeRateTx`, kur TEK kaynağı) TL'ye çevrilip toplanır. Kur okuması kilitten SONRA,
// salt okuma; sıfır olmayan tutarın kuru yoksa FAIL-CLOSED 409 `RISK_LIMIT_FX_MISSING` (kur 1 varsayılmaz).
// =============================================================================
import { Prisma, type Currency } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { settingRowPath } from "../../constants/panel-ayar-yolu";
import { ekranYolu } from "../../constants/panel-ekran-yolu";
import { readFinanceRiskLimitCurrencyMode, resolveRiskLimitBlockIntake, resolveRiskLimitBlockShipment } from "../system-setting.service";
import { factoryDayKeyUtcMidnight } from "../../constants/time";
import { resolveExchangeRateTx } from "./finance.helper";
import { cariAccountWhereForCard } from "./cari-card-where.helper";
import { CARI_HOLD_EMANET_SHIPMENT } from "./cari-hold.helper";

type Tx = Prisma.TransactionClient;

/** "Limiti tanımlı hesap" süzgeci — kapı ve bildirim kaynağı aynı parçayı kullanır (kayıt yokluğu sıfır limit değildir). */
export const RISK_LIMITED_ACCOUNT_WHERE = { riskLimit: { not: null } } as const satisfies Prisma.CariAccountWhereInput;

export interface RiskExposure {
  cariId: string;
  name: string;
  currency: Currency;
  limit: Prisma.Decimal;
  balance: Prisma.Decimal;
  extra: Prisma.Decimal;
  exposure: Prisma.Decimal;
  exceeded: boolean;
  /** TRY_CONVERTED kipinde true: `currency` = TRY, bakiye/ek/risk TL karşılığıdır. */
  converted: boolean;
}

/** TRY_CONVERTED: tutarın TL karşılığı; kur yoksa (ve tutar sıfır değilse) 409 `RISK_LIMIT_FX_MISSING`. */
async function toTryOrFail(
  tx: Pick<Tx, "exchangeRate">,
  { cariId, currency, amount, onDate }: { cariId: string; currency: Currency; amount: Prisma.Decimal; onDate: Date },
): Promise<Prisma.Decimal> {
  if (amount.isZero()) return amount;
  const rate = await resolveExchangeRateTx(tx, currency, onDate);
  if (rate) return amount.times(rate);
  throw AppError.conflict(
    `${currency} için hiç kur yok; ${ekranYolu("kurlar")} ekranından girin. ` +
      `Risk limiti TL'ye çevrilmiş toplamla ölçülüyor (${settingRowPath("financeRiskLimitCurrencyMode")}); kur 1 varsayılmaz.`,
    { code: "RISK_LIMIT_FX_MISSING", cariId, currency },
  );
}

/**
 * ÇEKİRDEK: carinin risk görünümü. `riskLimit` NULL → [] (limitsiz; kayıt yokluğu "sıfır limit" değildir).
 * `currency` verilirse o para biriminin satırı (yoksa bakiye 0); null → carinin TÜM bakiye satırları (para birimi
 * sırasıyla, belirlenimli kilit). Risk = bakiye (pozitif = cari bize borçlu) + `extra`; aşım = risk > limit.
 * TRY_CONVERTED kipinde TÜM bakiye satırları kilitlenir (aynı sorgu, para birimi süzgeçsiz) ve TEK satır döner
 * (`currency` TRY, `converted` true); `extra` `currency` cinsindendir, o da TL'ye çevrilir.
 */
export async function riskExposureTx(
  tx: Pick<Tx, "cariAccount" | "$queryRaw" | "systemSetting" | "exchangeRate">,
  cariId: string,
  currency: Currency | null,
  extra: Prisma.Decimal,
): Promise<RiskExposure[]> {
  const cari = await tx.cariAccount.findUnique({
    where: { id: cariId },
    select: { riskLimit: true, customer: { select: { name: true } }, subcontractor: { select: { name: true } } },
  });
  if (!cari?.riskLimit) return [];
  const converted = (await readFinanceRiskLimitCurrencyMode(tx)) === "TRY_CONVERTED";
  const only = converted ? null : currency;
  const rows = await tx.$queryRaw<Array<{ currency: Currency; balance: string | number | Prisma.Decimal }>>`
    SELECT currency, balance FROM cari_balances
     WHERE "cariId" = ${cariId}::uuid ${only ? Prisma.sql`AND currency = ${only}::"Currency"` : Prisma.empty}
     ORDER BY currency
     FOR UPDATE
  `;
  const limit = new Prisma.Decimal(cari.riskLimit);
  const name = cari.customer?.name ?? cari.subcontractor?.name ?? "Cari";
  if (converted) {
    const onDate = factoryDayKeyUtcMidnight();
    let balance = new Prisma.Decimal(0);
    for (const r of rows) balance = balance.plus(await toTryOrFail(tx, { cariId, currency: r.currency, amount: new Prisma.Decimal(String(r.balance)), onDate }));
    const extraTry = currency ? await toTryOrFail(tx, { cariId, currency, amount: extra, onDate }) : extra;
    const exposure = balance.plus(extraTry);
    return [{ cariId, name, currency: "TRY", limit, balance, extra: extraTry, exposure, exceeded: exposure.gt(limit), converted }];
  }
  const measured = rows.length || !currency ? rows : [{ currency, balance: 0 }];
  return measured.map((r) => {
    const balance = new Prisma.Decimal(String(r.balance));
    const exposure = balance.plus(extra);
    return { cariId, name, currency: r.currency, limit, balance, extra, exposure, exceeded: exposure.gt(limit), converted };
  });
}

export type RiskGateScope = "INTAKE" | "SHIPMENT";
const SCOPE_LABEL: Record<RiskGateScope, string> = { INTAKE: "yeni iş kabulü", SHIPMENT: "sevk" };

/**
 * KAPI (iş kabulü / sevk): ön muhasebe ya da ayar kapalıysa yalnız ayar okunur, başka sorgu yok (bugünkü davranış bayt-aynı). Açıkken
 * kartın limitli hesap(lar)ı (K3a where'i) için `riskExposureTx(…, null, 0)`; bir para biriminde aşım → 409
 * `RISK_LIMIT_EXCEEDED`. SHIPMENT'ta K22: `ownEmanetOnly` (tüm toplar sevk müşterisinin emaneti) yalnız aşım
 * VARSA (ya da TL kipinde kur yoksa) sorulur ve cari kilidinin kod sabitine uyar. Mesaj tutar taşımaz (sevk/kabul ekranı finans ekranı değil).
 */
export async function assertCustomerRiskLimitTx(
  tx: Pick<Tx, "cariAccount" | "$queryRaw" | "systemSetting" | "exchangeRate">,
  customerId: string,
  scope: RiskGateScope,
  ownEmanetOnly?: () => Promise<boolean>,
): Promise<void> {
  const enabled = scope === "INTAKE" ? await resolveRiskLimitBlockIntake(tx) : await resolveRiskLimitBlockShipment(tx);
  if (!enabled) return;
  const accounts = await tx.cariAccount.findMany({
    where: { AND: [cariAccountWhereForCard({ customerId, subcontractorId: null }), RISK_LIMITED_ACCOUNT_WHERE] },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const emanetExempt = async () => scope === "SHIPMENT" && CARI_HOLD_EMANET_SHIPMENT === "EXEMPT" && !!ownEmanetOnly && (await ownEmanetOnly());
  for (const acc of accounts) {
    let hit: RiskExposure | undefined;
    try {
      hit = (await riskExposureTx(tx, acc.id, null, new Prisma.Decimal(0))).find((e) => e.exceeded);
    } catch (err) {
      // K22: TL kipinde kur eksikliği de aşım gibi emanet muafiyetine sorulur (tamamı emanet sevk durmaz).
      if (err instanceof AppError && err.details?.code === "RISK_LIMIT_FX_MISSING" && (await emanetExempt())) return;
      throw err;
    }
    if (!hit) continue;
    if (await emanetExempt()) return;
    throw AppError.conflict(
      `"${hit.name}" risk limitini aştı (${hit.converted ? "TL'ye çevrilmiş toplam bakiye" : `${hit.currency} bakiyesi`} limitin üstünde) — ${SCOPE_LABEL[scope]} durduruldu. ` +
        `Tahsilat girildiğinde ya da limit Cari Kartından güncellendiğinde devam edilebilir; ` +
        `ayar: ${scope === "INTAKE" ? settingRowPath("financeRiskLimitBlockIntake") : settingRowPath("financeRiskLimitBlockShipment")}.`,
      { code: "RISK_LIMIT_EXCEEDED", scope, cariId: hit.cariId, currency: hit.currency },
    );
  }
}
