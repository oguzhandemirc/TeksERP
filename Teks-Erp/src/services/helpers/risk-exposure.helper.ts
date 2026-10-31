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
// ⚠️ `riskLimit` PARA BİRİMİ TAŞIMAZ (S12 cevapsız): her para birimindeki bakiye limitle AYRI ölçülür (fatura ilkesi).
// =============================================================================
import { Prisma, type Currency } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { settingRowPath } from "../../constants/panel-ayar-yolu";
import { resolveRiskLimitBlockIntake, resolveRiskLimitBlockShipment } from "../system-setting.service";
import { cariAccountWhereForCard } from "./cari-card-where.helper";
import type { EmanetShipmentRelease } from "./emanet-shipment.helper";

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
}

/**
 * ÇEKİRDEK: carinin risk görünümü. `riskLimit` NULL → [] (limitsiz; kayıt yokluğu "sıfır limit" değildir).
 * `currency` verilirse o para biriminin satırı (yoksa bakiye 0); null → carinin TÜM bakiye satırları (para birimi
 * sırasıyla, belirlenimli kilit). Risk = bakiye (pozitif = cari bize borçlu) + `extra`; aşım = risk > limit.
 */
export async function riskExposureTx(
  tx: Pick<Tx, "cariAccount" | "$queryRaw">,
  cariId: string,
  currency: Currency | null,
  extra: Prisma.Decimal,
): Promise<RiskExposure[]> {
  const cari = await tx.cariAccount.findUnique({
    where: { id: cariId },
    select: { riskLimit: true, customer: { select: { name: true } }, subcontractor: { select: { name: true } } },
  });
  if (!cari?.riskLimit) return [];
  const rows = await tx.$queryRaw<Array<{ currency: Currency; balance: string | number | Prisma.Decimal }>>`
    SELECT currency, balance FROM cari_balances
     WHERE "cariId" = ${cariId}::uuid ${currency ? Prisma.sql`AND currency = ${currency}::"Currency"` : Prisma.empty}
     ORDER BY currency
     FOR UPDATE
  `;
  const measured = rows.length || !currency ? rows : [{ currency, balance: 0 }];
  const limit = new Prisma.Decimal(cari.riskLimit);
  const name = cari.customer?.name ?? cari.subcontractor?.name ?? "Cari";
  return measured.map((r) => {
    const balance = new Prisma.Decimal(String(r.balance));
    const exposure = balance.plus(extra);
    return { cariId, name, currency: r.currency, limit, balance, extra, exposure, exceeded: exposure.gt(limit) };
  });
}

export type RiskGateScope = "INTAKE" | "SHIPMENT";
const SCOPE_LABEL: Record<RiskGateScope, string> = { INTAKE: "yeni iş kabulü", SHIPMENT: "sevk" };

/**
 * KAPI (iş kabulü / sevk): ön muhasebe ya da ayar kapalıysa yalnız ayar okunur, başka sorgu yok (bugünkü davranış bayt-aynı). Açıkken
 * kartın limitli hesap(lar)ı (K3a where'i) için `riskExposureTx(…, null, 0)`; bir para biriminde aşım → 409
 * `RISK_LIMIT_EXCEEDED`. SHIPMENT'ta K22: `emanetRelease` (`emanetShipmentReleaseTx`, ayar `finance.cariHold.emanetShipment`)
 * yalnız aşım VARSA sorulur; cari kilidiyle AYNI karar (D4-I1c). Mesaj tutar taşımaz (sevk/kabul ekranı finans ekranı değil).
 */
export async function assertCustomerRiskLimitTx(
  tx: Pick<Tx, "cariAccount" | "$queryRaw" | "systemSetting">,
  customerId: string,
  scope: RiskGateScope,
  emanetRelease?: () => Promise<EmanetShipmentRelease>,
): Promise<void> {
  const enabled = scope === "INTAKE" ? await resolveRiskLimitBlockIntake(tx) : await resolveRiskLimitBlockShipment(tx);
  if (!enabled) return;
  const accounts = await tx.cariAccount.findMany({
    where: { AND: [cariAccountWhereForCard({ customerId, subcontractorId: null }), RISK_LIMITED_ACCOUNT_WHERE] },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const acc of accounts) {
    const hit = (await riskExposureTx(tx, acc.id, null, new Prisma.Decimal(0))).find((e) => e.exceeded);
    if (!hit) continue;
    const release = scope === "SHIPMENT" && emanetRelease ? await emanetRelease() : null;
    if (release?.exempt) return;
    throw AppError.conflict(
      `"${hit.name}" risk limitini aştı (${hit.currency} bakiyesi limitin üstünde) — ${SCOPE_LABEL[scope]} durduruldu. ` +
        `Tahsilat girildiğinde ya da limit Cari Kartından güncellendiğinde devam edilebilir; ` +
        `ayar: ${scope === "INTAKE" ? settingRowPath("financeRiskLimitBlockIntake") : settingRowPath("financeRiskLimitBlockShipment")}.`,
      { code: "RISK_LIMIT_EXCEEDED", scope, cariId: hit.cariId, currency: hit.currency, ...(release?.heldRolls.length ? { emanetShipment: release.mode, heldRolls: release.heldRolls } : {}) },
    );
  }
}
