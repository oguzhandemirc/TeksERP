// =============================================================================
// TeksERP — RAŞEL TAKIMI (#23): "N adet" sarımda kardeş leventler, iplik payı, gövde ön kontrolü
// =============================================================================
// Raşel takımında N levent AYNI cağlıktan AYNI ANDA sarılır: cağlığa yüklenen kg TOPLAMDIR, levent
// başına nominal = tel × denye × L / 9e6 (her levent TAM boy) ⇒ çıkış ve dip iadesi satırları ÷ N
// (3 hane; kuruş SON levente, Σ = toplam birebir). Kardeş bağı AÇIK kolon `WarpBeam.setKey`
// (aynı tx'te doğanlar aynı anahtar); `beamRole` Faz 5 kataloğuna saklı, aşırı yüklenmez (1e S1).
// Bu dosya SAF + salt-okuma: kardeş doğuşu (yazım + audit) `warp-beam-wind.service`te.
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Toplamı N paya böler (3 hane); yuvarlama kuruşu SON payda — Σ pay = toplam BİREBİR. */
export function splitShares(total: Prisma.Decimal, n: number): Prisma.Decimal[] {
  if (n <= 1) return [total];
  const base = total.div(n).toDecimalPlaces(3, Prisma.Decimal.ROUND_DOWN);
  const shares = Array.from({ length: n - 1 }, () => base);
  shares.push(total.minus(base.mul(n - 1)));
  return shares;
}

/** Gövde numarası: önek verildiyse `${önek}-${k}` (k = 1..N); ilk leventin kendi gövde no'su varsa korunur. */
export function siblingPhysicalNo(prefix: string | null, k: number, own: string | null): string | null {
  if (k === 1 && own) return own;
  if (!prefix) return k === 1 ? own : null;
  return `${prefix}-${k}`.slice(0, 32);
}

/** Aynı gövde numarasında (tr_fold) başka bir CANLI çözgü varsa 409 — `warp_beams_physical_live_uq` ikinci hattır (tx içi de çağrılır). */
export async function assertPhysicalBeamFreeTx(client: Pick<Tx, "$queryRaw">, beamId: string | null, physicalBeamNo: string | null, beamNo: string): Promise<void> {
  if (!physicalBeamNo) return;
  const rows = await client.$queryRaw<Array<{ beamNo: string }>>`
    SELECT "beamNo" FROM warp_beams
    WHERE public.tr_fold("physicalBeamNo") = public.tr_fold(${physicalBeamNo}) AND status IN ('READY', 'SHIPPED_OUT', 'MOUNTED') AND id <> ${beamId ?? "00000000-0000-0000-0000-000000000000"}::uuid
    LIMIT 1`;
  if (rows[0]) {
    throw AppError.conflict(`"${physicalBeamNo}" gövdesinde canlı bir çözgü var: ${rows[0].beamNo} — ${beamNo} sarılamaz; gövdeyi boşaltın ya da başka gövde yazın.`, { code: "WARP_BEAM_PHYSICAL_BUSY", busyBeamNo: rows[0].beamNo });
  }
}

/** İplik satırlarının k. pay kopyası (miktar ÷ N, kuruş sonda) — depo/lot/sebep aynen. */
export function lineShares<T extends { qtyKg: Prisma.Decimal.Value }>(lines: T[], n: number): T[][] {
  const perLine = lines.map((l) => splitShares(D(l.qtyKg).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP), n));
  return Array.from({ length: n }, (_, k) => lines.map((l, i) => ({ ...l, qtyKg: perLine[i][k] })));
}
