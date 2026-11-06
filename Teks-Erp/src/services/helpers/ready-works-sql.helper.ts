// =============================================================================
// SEVKE HAZIR İŞLER — birim üyeliği ve toplam SQL'i (`ready-works.service`ten taşındı, S15c-d1)
// =============================================================================
// Liste (`computeReadyWorks`), top ucu (`ready-work-rolls`) ve K28 foto saklama taraması aynı üyelik parçasını okur;
// servis bu dosyayı yeniden dışa aktarır. Sınıf/üyelik yüklemleri `ship-readiness.helper`dan (tek kaynak).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { ReadyWorkUnit } from "../../constants/ready-work-units";
import {
  customerBatchKeySql,
  customerBatchMemberSql,
  liveReadinessSql,
  loadedRollSql,
  readinessClassSql,
} from "./ship-readiness.helper";

/** `roll-delivery-note-line.helper` yukarı çözücüsüyle aynı tavan (döngüsel veri sonsuz yürümesin). */
const MAX_DESCENT_DEPTH = 32;

// ---------------------------------------------------------------------------
// BİRİM ÜYELİĞİ — (unit_id, roll_id) çiftleri; tek SQL parçası, liste ve top ucu aynısını kullanır.
// ---------------------------------------------------------------------------
// Müşteri partisi anahtarı TEK yerde: `customerBatchKeySql` (`ship-readiness.helper`; belgeden iş emri aynısını okur).

/**
 * Birimde en az bir CANLI (HAZIR ∪ İŞLEMDE) top olan birim kimlikleri (`unit_id` metni). Liste HAVING'i canlı topu
 * olmayan birimi zaten düşürdüğünden bu ön süzgeç sonucu değiştirmez; bütün `rolls` geçmişinin sınıflanmasını önler
 * (S15c-d1). Belge birimleri: canlı toptan YUKARI (`parentRollId`, aynı derinlik tavanı) satır topuna çıkılır;
 * LATERAL + OFFSET 0 her adımı birincil anahtar aramasına zorlar (özyineleme tahmini tam tarama seçtiriyordu).
 */
export function liveUnitIdsSql(unit: ReadyWorkUnit): Prisma.Sql {
  switch (unit) {
    case "workOrder":
      return Prisma.sql`SELECT DISTINCT lb."workOrderId"::text AS unit_id FROM rolls lr JOIN batches lb ON lb.id = lr."batchId" WHERE ${liveReadinessSql("lr")}`;
    case "customer":
      return Prisma.sql`SELECT DISTINCT lr."ownerCustomerId"::text AS unit_id FROM rolls lr WHERE lr."ownerCustomerId" IS NOT NULL AND ${liveReadinessSql("lr")}`;
    case "deliveryNote":
    case "customerBatch": {
      const key = unit === "deliveryNote" ? Prisma.sql`ln.id::text` : customerBatchKeySql("ln");
      const unitFilter = unit === "customerBatch" ? Prisma.sql`AND ${customerBatchMemberSql("ln")}` : Prisma.empty;
      return Prisma.sql`
        WITH RECURSIVE up(roll_id, parent_id, depth) AS (
          SELECT lr.id, lr."parentRollId", 0 FROM rolls lr WHERE ${liveReadinessSql("lr")}
          UNION
          SELECT p.id, p."parentRollId", u.depth + 1
          FROM up u CROSS JOIN LATERAL (SELECT x.id, x."parentRollId" FROM rolls x WHERE x.id = u.parent_id OFFSET 0) p
          WHERE u.depth < ${MAX_DESCENT_DEPTH}
        )
        SELECT DISTINCT ${key} AS unit_id FROM up
        JOIN customer_delivery_note_lines ll ON ll."rollId" = up.roll_id
        JOIN customer_delivery_notes ln ON ln.id = ll."noteId"
        WHERE ln.status::text <> 'CANCELLED' ${unitFilter}`;
    }
  }
}

/**
 * `onlyIds`: birden çok birimin üyeliği tek sorguda — kimlik listesi (K28 sevkte silme taraması) ya da `unit_id` metni
 * dönen alt sorgu (liste toplamında canlı birimler). Boş liste süzgeç DEĞİLDİR (bütün birimler) — çağıran kısa devre eder.
 */
export function membershipSql(unit: ReadyWorkUnit, onlyId?: string, onlyIds?: readonly string[] | Prisma.Sql): Prisma.Sql {
  const sub = onlyIds && !Array.isArray(onlyIds) ? (onlyIds as Prisma.Sql) : null;
  const many = !sub && onlyIds && (onlyIds as readonly string[]).length ? [...(onlyIds as readonly string[])] : null;
  const uuidIn = (col: Prisma.Sql): Prisma.Sql | null =>
    sub ? Prisma.sql`${col} IN (SELECT s.unit_id::uuid FROM (${sub}) s)` : many ? Prisma.sql`${col} = ANY(${many}::uuid[])` : null;
  switch (unit) {
    case "workOrder": {
      const f = onlyId ? Prisma.sql`b."workOrderId" = ${onlyId}::uuid` : uuidIn(Prisma.raw(`b."workOrderId"`));
      return Prisma.sql`
        SELECT b."workOrderId"::text AS unit_id, r.id AS roll_id
        FROM rolls r JOIN batches b ON b.id = r."batchId"
        ${f ? Prisma.sql`WHERE ${f}` : Prisma.empty}`;
    }
    case "customer": {
      const f = onlyId ? Prisma.sql`r."ownerCustomerId" = ${onlyId}::uuid` : uuidIn(Prisma.raw(`r."ownerCustomerId"`));
      return Prisma.sql`
        SELECT r."ownerCustomerId"::text AS unit_id, r.id AS roll_id
        FROM rolls r
        WHERE r."ownerCustomerId" IS NOT NULL
        ${f ? Prisma.sql`AND ${f}` : Prisma.empty}`;
    }
    case "deliveryNote":
    case "customerBatch": {
      const key = unit === "deliveryNote" ? Prisma.sql`n.id::text` : customerBatchKeySql("n");
      const unitFilter = unit === "customerBatch"
        ? Prisma.sql`AND ${customerBatchMemberSql("n")}`
        : Prisma.empty;
      const idFilter = onlyId ? Prisma.sql`AND ${key} = ${onlyId}`
        : sub ? Prisma.sql`AND ${key} IN (SELECT s.unit_id FROM (${sub}) s)`
        // Belge kümesi uuid[] ile `n.id` üzerinden (indeks); metin karşılaştırması K28 darboğazıydı (S15c-d2).
        : many ? (unit === "deliveryNote" ? Prisma.sql`AND n.id = ANY(${many}::uuid[])` : Prisma.sql`AND ${key} = ANY(${many}::text[])`)
        : Prisma.empty;
      // Kök: belgenin onayla doğan topları; aşağı soy `parentRollId` (tambur bölmesi) üzerinden, derinlik tavanlı.
      // LATERAL + OFFSET 0: her adım `parentRollId` indeksinden (özyineleme tahmini her turda tam tarama seçtiriyordu).
      return Prisma.sql`
        SELECT DISTINCT t.unit_id, t.roll_id FROM (
          WITH RECURSIVE tree(unit_id, roll_id, depth) AS (
            SELECT ${key} AS unit_id, l."rollId" AS roll_id, 0
            FROM customer_delivery_note_lines l
            JOIN customer_delivery_notes n ON n.id = l."noteId"
            WHERE l."rollId" IS NOT NULL AND n.status::text <> 'CANCELLED' ${unitFilter} ${idFilter}
            UNION ALL
            SELECT t.unit_id, c.id, t.depth + 1
            FROM tree t CROSS JOIN LATERAL (SELECT x.id FROM rolls x WHERE x."parentRollId" = t.roll_id OFFSET 0) c
            WHERE t.depth < ${MAX_DESCENT_DEPTH}
          )
          SELECT unit_id, roll_id FROM tree
        ) t`;
    }
  }
}

export interface AggRow {
  unit_id: string;
  ready_count: bigint;
  ready_m: Prisma.Decimal | null;
  loaded_count: bigint;
  loaded_m: Prisma.Decimal | null;
  in_process_count: bigint;
  in_process_m: Prisma.Decimal | null;
  shipped_m: Prisma.Decimal | null;
  scrap_m: Prisma.Decimal | null;
}

/** Canlı birim kümesi (`onlyIds` metin eşitliğiyle daraltılmış) — `unit_id` metni dönen alt sorgu. */
export function liveUnitScopeSql(unit: ReadyWorkUnit, onlyIds?: readonly string[]): Prisma.Sql {
  const want = onlyIds ? Prisma.sql`WHERE lu.unit_id = ANY(${[...onlyIds]}::text[])` : Prisma.empty;
  return Prisma.sql`SELECT lu.unit_id FROM (${liveUnitIdsSql(unit)}) lu ${want}`;
}

/**
 * Birim toplamları SQL'i — yalnız `units` (kimlik listesi ya da `liveUnitScopeSql` alt sorgusu) üyeleri sınıflanır.
 * HAVING canlı-birim koşulunu yine taşır: ön süzgeç sonucu değiştirmez, yalnız taranan geçmişi keser.
 */
export function aggregateUnitsSql(unit: ReadyWorkUnit, units: readonly string[] | Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH members AS (${membershipSql(unit, undefined, units)}),
    classed AS (
      SELECT m.unit_id, r."currentQty" AS qty, ${readinessClassSql("r")} AS cls, ${loadedRollSql("r")} AS loaded
      FROM members m ${unit === "deliveryNote" || unit === "customerBatch"
        ? Prisma.sql`CROSS JOIN LATERAL (SELECT x."currentQty", x.status, x."sackId", x."shipmentId" FROM rolls x WHERE x.id = m.roll_id OFFSET 0) r`
        : Prisma.sql`JOIN rolls r ON r.id = m.roll_id`}
    )
    SELECT unit_id,
      COUNT(*) FILTER (WHERE cls = 'READY' AND NOT loaded) AS ready_count,
      SUM(qty) FILTER (WHERE cls = 'READY' AND NOT loaded) AS ready_m,
      COUNT(*) FILTER (WHERE cls = 'READY' AND loaded) AS loaded_count,
      SUM(qty) FILTER (WHERE cls = 'READY' AND loaded) AS loaded_m,
      COUNT(*) FILTER (WHERE cls = 'IN_PROCESS')       AS in_process_count,
      SUM(qty) FILTER (WHERE cls = 'IN_PROCESS')       AS in_process_m,
      SUM(qty) FILTER (WHERE cls = 'GONE')             AS shipped_m,
      SUM(qty) FILTER (WHERE cls = 'SCRAP')            AS scrap_m
    FROM classed
    WHERE cls IS NOT NULL
    GROUP BY unit_id
    HAVING COUNT(*) FILTER (WHERE cls IN ('READY', 'IN_PROCESS')) > 0`;
}

/**
 * JIT kapalı salt okuma: özyinelemeli soyun satır tahmini maliyeti jit eşiklerinin üstüne taşıyor, derleme sorgunun
 * kendisinden uzun sürüyordu (S15c-d1 ölçümü: belge biriminde 1,2–2,7 sn). Sonuç aynı; yalnız plan derlemesi.
 */
async function queryWithoutJit<T>(sql: Prisma.Sql): Promise<T[]> {
  const [, rows] = await prisma.$transaction([prisma.$executeRaw`SET LOCAL jit = off`, prisma.$queryRaw<T[]>(sql)]);
  return rows;
}

export async function aggregateUnits(unit: ReadyWorkUnit, onlyIds?: readonly string[]): Promise<AggRow[]> {
  // Belge birimleri: canlı küme alt sorgu olarak TEK ifadede, JIT kapalı tek işlemde (özyinelemeli soy JIT'i tetikler).
  if (unit === "deliveryNote" || unit === "customerBatch") return queryWithoutJit<AggRow>(aggregateUnitsSql(unit, liveUnitScopeSql(unit, onlyIds)));
  // İE/müşteri: JIT yok; kimlik listesi olarak geçmek alt sorgudan hızlı ölçüldü (müşteri 170 ↔ 510 ms).
  const ids = (await prisma.$queryRaw<Array<{ unit_id: string }>>(liveUnitScopeSql(unit, onlyIds))).map((r) => r.unit_id);
  if (ids.length === 0) return [];
  return prisma.$queryRaw<AggRow[]>(aggregateUnitsSql(unit, ids));
}
