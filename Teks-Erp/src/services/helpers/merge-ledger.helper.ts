// =============================================================================
// BİRLEŞTİRME DEFTERİ YARDIMCISI — taşınan/silinen satırın KİMLİĞİNİ yakalar
// =============================================================================
// Birleştirme bugün `UPDATE … WHERE col = ANY(sources)` ile taşıyor ve geriye
// yalnız SAYI bırakıyordu: "hangi satır taşındı" sorusunun cevabı yoktu, yani
// geri alma da yoktu. Buradaki üç yazar o cevabı defterden okunabilir hâle getirir:
//
//   • `movePerSourceTx`   — taşıma KAYNAK BAŞINA koşar ve PK'ları RETURNING ile alır
//     (tek `UPDATE` hangi satırın hangi kaynaktan geldiğini söyleyemez).
//   • `deleteCapturingTx` — çakışma politikasının sildiği satırın TAM fotoğrafını alır
//     (geri alma satırı fotoğraftan yeniden yazar; ③b yapılandırma pivotu sınıfı).
//   • `snapshotRowsTx`    — `MERGE_FIELDS` survivor satırını ZENGİNLEŞTİRMEDEN ÖNCE.
//
// ⚠️ PK ÇALIŞMA ANINDA ÇÖZÜLÜR (`pg_index`), haritaya elle yazılmaz: 56 kurallı
// haritaya ikinci bir envanter eklemek "elle sayılan kapsam listesi" yasağına
// girer ve bir gün ayrışır. Bugün tek composite PK'lı tablo
// `subcontractor_category_links`; kod onu özel-kasa olarak BİLMEZ, PK'sından görür.
// =============================================================================
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Tablo → PK kolonları (tx ömrü boyunca önbelleklenir; katalog sorgusu ucuzdur). */
export type PkCache = Map<string, string[]>;

export function newPkCache(): PkCache {
  return new Map();
}

export async function primaryKeyColumnsTx(tx: Tx, table: string, cache: PkCache): Promise<string[]> {
  const hit = cache.get(table);
  if (hit) return hit;
  const rows = await tx.$queryRawUnsafe<Array<{ attname: string }>>(
    `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY a.attnum`,
    `"${table}"`,
  );
  const cols = rows.map((r) => r.attname);
  if (cols.length === 0) {
    // PK'sız tablo taşınırsa geri alma kimliği YOK demektir — sessiz geçmek
    // "geri alınabilir" yalanını üretir.
    throw new Error(`merge-ledger: "${table}" tablosunda PRIMARY KEY yok — taşınan satır kimliklenemez.`);
  }
  cache.set(table, cols);
  return cols;
}

export interface MovedRows {
  count: number;
  /** Tek kolonlu uuid PK'da satır id'leri. */
  rowIds: string[];
  /** Composite PK'da anahtar nesneleri (taşıma SONRASI değerlerle). */
  rowKeys: Array<Record<string, unknown>> | null;
}

/**
 * Bir kaynağın satırlarını survivor'a taşır ve taşınan satırların PK'sını döner.
 * Taşıma kaynak başına koşar: tek `UPDATE … = ANY(sources)` hangi satırın hangi
 * kaynaktan geldiğini SÖYLEYEMEZ ve geri alma onu tahmin edemez.
 */
export async function movePerSourceTx(
  tx: Tx,
  params: { table: string; column: string; survivorId: string; sourceId: string },
  cache: PkCache,
): Promise<MovedRows> {
  const pk = await primaryKeyColumnsTx(tx, params.table, cache);
  const single = pk.length === 1 && pk[0] === "id";
  const returning = single
    ? `"id"::text AS id`
    : `jsonb_build_object(${pk.map((c) => `'${c}', "${c}"`).join(", ")}) AS key`;
  const rows = await tx.$queryRawUnsafe<Array<{ id?: string; key?: Record<string, unknown> }>>(
    `UPDATE "${params.table}" SET "${params.column}" = $1::uuid
      WHERE "${params.column}" = $2::uuid
      RETURNING ${returning}`,
    params.survivorId,
    params.sourceId,
  );
  return {
    count: rows.length,
    rowIds: single ? rows.map((r) => String(r.id)) : [],
    rowKeys: single ? null : rows.map((r) => r.key ?? {}),
  };
}

/** Satırları siler ve silinenlerin TAM fotoğrafını döner (geri alma yeniden yazar). */
export async function deleteCapturingTx(
  tx: Tx,
  params: { table: string; where: string; args: unknown[] },
): Promise<Array<Record<string, unknown>>> {
  const rows = await tx.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(
    `DELETE FROM "${params.table}" s WHERE ${params.where} RETURNING to_jsonb(s.*) AS row`,
    ...params.args,
  );
  return rows.map((r) => r.row);
}

/** Değişmeden ÖNCE satır fotoğrafı (MERGE_FIELDS survivor satırı). */
export async function snapshotRowsTx(
  tx: Tx,
  params: { table: string; where: string; args: unknown[] },
): Promise<Array<Record<string, unknown>>> {
  const rows = await tx.$queryRawUnsafe<Array<{ row: Record<string, unknown> }>>(
    `SELECT to_jsonb(t.*) AS row FROM "${params.table}" t WHERE ${params.where}`,
    ...params.args,
  );
  return rows.map((r) => r.row);
}

/**
 * Taşınmış satırları KAYNAĞA geri yazar. Yalnız HÂLÂ survivor'a bakan ve
 * defterdeki kimliğe uyan satırlar döner; arada başkasına taşınmış/silinmiş satır
 * ATLANIR ve sayısı çağırana bildirilir (sessiz "hepsi döndü" yalanı yok).
 */
export async function repointBackTx(
  tx: Tx,
  params: {
    table: string;
    column: string;
    survivorId: string;
    sourceId: string;
    rowIds: string[];
    rowKeys: Array<Record<string, unknown>> | null;
  },
): Promise<number> {
  if (params.rowKeys && params.rowKeys.length > 0) {
    let moved = 0;
    for (const key of params.rowKeys) {
      const cols = Object.keys(key).filter((c) => c !== params.column);
      const where = cols.map((c, i) => `"${c}" = $${i + 3}`).join(" AND ");
      const args = cols.map((c) => key[c]);
      moved += Number(
        await tx.$executeRawUnsafe(
          `UPDATE "${params.table}" SET "${params.column}" = $1::uuid
            WHERE "${params.column}" = $2::uuid${where ? ` AND ${where}` : ""}`,
          params.sourceId,
          params.survivorId,
          ...args,
        ),
      );
    }
    return moved;
  }
  if (params.rowIds.length === 0) return 0;
  return Number(
    await tx.$executeRawUnsafe(
      `UPDATE "${params.table}" SET "${params.column}" = $1::uuid
        WHERE "${params.column}" = $2::uuid AND "id" = ANY($3::uuid[])`,
      params.sourceId,
      params.survivorId,
      params.rowIds,
    ),
  );
}

/**
 * Silinen satırları fotoğraftan yeniden yazar. Aynı anahtar bu arada yeniden
 * doğmuşsa satır ATLANIR (`ON CONFLICT DO NOTHING`) — yazılan sayı dönen değerdir.
 */
export async function restoreDeletedRowsTx(
  tx: Tx,
  params: { table: string; rows: Array<Record<string, unknown>> },
): Promise<number> {
  if (params.rows.length === 0) return 0;
  return Number(
    await tx.$executeRawUnsafe(
      `INSERT INTO "${params.table}"
       SELECT * FROM jsonb_populate_recordset(NULL::"${params.table}", $1::jsonb)
       ON CONFLICT DO NOTHING`,
      JSON.stringify(params.rows),
    ),
  );
}

/**
 * Zenginleşmiş (MERGE_FIELDS) survivor satırlarını fotoğraftaki hâline döndürür.
 * Tek ifade: fotoğraf `jsonb_populate_recordset` ile TABLONUN KENDİ satır tipine
 * çevrilir (tip dönüşümünü PG yapar, elle cast yok) ve PK üzerinden eşlenir.
 * Dönen sayı yazılan satırdır; PK'sı artık bulunmayan satır sessizce atlanır.
 */
export async function restoreSnapshotRowsTx(
  tx: Tx,
  params: { table: string; rows: Array<Record<string, unknown>> },
  cache: PkCache,
): Promise<number> {
  const first = params.rows[0];
  if (!first) return 0;
  const pk = await primaryKeyColumnsTx(tx, params.table, cache);
  const cols = Object.keys(first).filter((c) => !pk.includes(c));
  if (cols.length === 0) return 0;
  const sets = cols.map((c) => `"${c}" = r."${c}"`).join(", ");
  const match = pk.map((c) => `t."${c}" = r."${c}"`).join(" AND ");
  return Number(
    await tx.$executeRawUnsafe(
      `UPDATE "${params.table}" t SET ${sets}
         FROM jsonb_populate_recordset(NULL::"${params.table}", $1::jsonb) r
        WHERE ${match}`,
      JSON.stringify(params.rows),
    ),
  );
}
