// =============================================================================
// KURŞUN METRE SAPMASI — SQL İKİZİ (`lib/kursun-meter-variance.ts` ile boğaz-ikiz)
// =============================================================================
// Aynı eşitsizlik NUMERIC'te: |out − taban|·100 > max(M·100, P·taban); eşikler boş ya da
// taban yoksa false. Bekçi `test_kursun_sapma` 20 fikstürde TS kararıyla eşitliği ölçer.
// Bildirilen giriş: gelen belge satırı metresi (`customer_delivery_note_lines.rollId @unique`),
// yoksa topun doğuş metresi — TS tarafı `evaluateReadingVarianceTx` aynı ifadeyi (`loadDeclaredInTx`) okur.
// =============================================================================
import { Prisma } from "@prisma/client";

/**
 * Sonradan imza ALINABİLEN kipler (H4 kararı, "çıkışsız kapı açılmaz"): OPERATOR_REASON'da sebep yazım
 * anında alınır; sonradan kayan sapmanın imza yolu yoktur ⇒ "imzasız sapma" işaretidir, kapı değil.
 * Bellek-içi (`awaitsMeterSignature`) ve SQL (`readingPendingAckSql`) yüklemi BU listeden okur.
 */
export const METER_SIGNATURE_MODES = ["SUPERVISOR_PIN", "OFFICE"] as const;

/** Bellek-içi ikiz: okuma imza bekliyor mu (sapma + imza kipli + aktif onay yok). */
export function awaitsMeterSignature(approvalMode: string, needsAck: boolean, acked: boolean): boolean {
  return needsAck && !acked && (METER_SIGNATURE_MODES as readonly string[]).includes(approvalMode);
}

export interface MeterVarianceSqlArgs {
  out: Prisma.Sql;
  declaredIn: Prisma.Sql;
  measuredIn: Prisma.Sql;
  thresholdM: Prisma.Sql;
  thresholdPct: Prisma.Sql;
  basis: Prisma.Sql;
}

/** Boolean SQL ifadesi: okuma sapmalı mı. Girdiler sütun ya da parametre ifadesidir. */
export function meterDeviatedSql(a: MeterVarianceSqlArgs): Prisma.Sql {
  const base = meterBaseSql(a);
  return Prisma.sql`(CASE
    WHEN (${a.thresholdM}) IS NULL AND (${a.thresholdPct}) IS NULL THEN false
    WHEN ${base} IS NULL THEN false
    ELSE abs(round((${a.out})::numeric, 3) - ${base}) * 100
         > GREATEST(COALESCE(round((${a.thresholdM})::numeric, 3), 0) * 100,
                    COALESCE(round((${a.thresholdPct})::numeric, 3), 0) * ${base})
  END)`;
}

/** Karşılaştırma tabanı (3 ondalık): MEASURED_IN ve ölçülen varsa ölçülen, yoksa bildirilen. */
export function meterBaseSql(a: Pick<MeterVarianceSqlArgs, "basis" | "measuredIn" | "declaredIn">): Prisma.Sql {
  return Prisma.sql`round((CASE WHEN (${a.basis})::text = 'MEASURED_IN' AND (${a.measuredIn}) IS NOT NULL
    THEN (${a.measuredIn})::numeric ELSE (${a.declaredIn})::numeric END), 3)`;
}

/** Okuma satırı (`alias`) için taban (liste farkı ve özet ortalaması). */
export function readingBaseSql(readingAlias: string): Prisma.Sql {
  const r = Prisma.raw(readingAlias);
  return meterBaseSql({ basis: Prisma.sql`${r}.basis`, measuredIn: measuredInSql(readingAlias), declaredIn: declaredInSql(readingAlias) });
}

/**
 * Bildirilen giriş (TEK KAYNAK; TS yükleyici `loadDeclaredInTx` de bunu okur): gelen belge satırı metresi,
 * yoksa topun DOĞUŞ metresi = `initialQty` − Σ aktif `initialQtyRaise` (H1b APPLY artı yönü `initialQty`yi
 * yükseltir; taban "ne oldu"dan okunur, kaymaz). `rollIdExpr` top kimliği veren SQL ifadesidir.
 */
export function rollDeclaredInSql(rollIdExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`COALESCE(
    (SELECT l.meters FROM customer_delivery_note_lines l WHERE l."rollId" = ${rollIdExpr}),
    (SELECT ro."initialQty" - COALESCE((SELECT sum(v."initialQtyRaise") FROM roll_variances v
        WHERE v."rollId" = ro.id AND v."reversedAt" IS NULL AND v."initialQtyRaise" IS NOT NULL), 0)
      FROM rolls ro WHERE ro.id = ${rollIdExpr}))`;
}

/** Okuma satırı (`alias`) için bildirilen giriş — `rollDeclaredInSql`. */
export function declaredInSql(readingAlias: string): Prisma.Sql {
  const r = Prisma.raw(readingAlias);
  return rollDeclaredInSql(Prisma.sql`${r}."rollId"`);
}

/** Tek top için bildirilen giriş (bellek-içi karar yükleyicisi; SQL ikiziyle aynı ifade). */
export async function loadDeclaredInTx(db: Pick<Prisma.TransactionClient, "$queryRaw">, rollId: string): Promise<Prisma.Decimal | null> {
  const rows = await db.$queryRaw<Array<{ d: Prisma.Decimal | null }>>`SELECT ${rollDeclaredInSql(Prisma.sql`${rollId}::uuid`)} AS d`;
  return rows[0]?.d ?? null;
}

/** Okuma satırı (`alias`) için aynı adımdaki aktif giriş (IN) okuması. */
export function measuredInSql(readingAlias: string): Prisma.Sql {
  const r = Prisma.raw(readingAlias);
  return Prisma.sql`(SELECT mi.meters FROM roll_meter_readings mi
    WHERE mi."rollId" = ${r}."rollId" AND mi."workOrderStepId" = ${r}."workOrderStepId"
      AND mi.phase = 'IN'::"MeterPhase" AND mi."revokedAt" IS NULL)`;
}

/** Okuma satırı (`alias`) için tam sapma yüklemi — kopya kolonlarından. */
export function readingDeviatedSql(readingAlias: string): Prisma.Sql {
  const r = Prisma.raw(readingAlias);
  return meterDeviatedSql({
    out: Prisma.sql`${r}.meters`,
    declaredIn: declaredInSql(readingAlias),
    measuredIn: measuredInSql(readingAlias),
    thresholdM: Prisma.sql`${r}."thresholdM"`,
    thresholdPct: Prisma.sql`${r}."thresholdPct"`,
    basis: Prisma.sql`${r}.basis`,
  });
}

/** İmza bekleyen OUT okumaları: aktif, kip imza kipli (`METER_SIGNATURE_MODES`), aktif onay yok, sapmalı. `alias` FROM'da tanımlı olmalı. */
export function readingPendingAckSql(readingAlias: string): Prisma.Sql {
  const r = Prisma.raw(readingAlias);
  const modes = Prisma.join(METER_SIGNATURE_MODES.map((m) => Prisma.sql`${m}::"MeterApprovalMode"`));
  return Prisma.sql`${r}.phase = 'OUT'::"MeterPhase" AND ${r}."revokedAt" IS NULL
    AND ${r}."approvalMode" IN (${modes})
    AND NOT EXISTS (SELECT 1 FROM roll_meter_acks ak WHERE ak."readingId" = ${r}.id AND ak."revokedAt" IS NULL)
    AND ${readingDeviatedSql(readingAlias)}`;
}

/** Tablet adım özetindeki top tabanı (H3b): bildirilen giriş + aktif IN okuması. */
export interface RollMeterBase {
  declaredIn: number | null;
  measuredIn: number | null;
}

/**
 * Adımdaki toplar için sapma tabanları TEK sorguda (N+1 yok). Kaynak SQL ikizinin kendisidir
 * (`declaredInSql`/`measuredInSql`): türetilmiş satır okuma satırının (`rollId`, `workOrderStepId`) yerini tutar.
 */
export async function loadRollMeterBases(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  stepId: string,
  rollIds: string[],
): Promise<Map<string, RollMeterBase>> {
  if (rollIds.length === 0) return new Map();
  const rows = await db.$queryRaw<Array<{ rollId: string; declaredIn: Prisma.Decimal | null; measuredIn: Prisma.Decimal | null }>>`
    SELECT x."rollId", ${declaredInSql("x")} AS "declaredIn", ${measuredInSql("x")} AS "measuredIn"
    FROM (SELECT DISTINCT unnest(${rollIds}::uuid[]) AS "rollId", ${stepId}::uuid AS "workOrderStepId") x`;
  const num = (d: Prisma.Decimal | null): number | null => (d == null ? null : Number(d));
  return new Map(rows.map((r) => [r.rollId, { declaredIn: num(r.declaredIn), measuredIn: num(r.measuredIn) }]));
}
