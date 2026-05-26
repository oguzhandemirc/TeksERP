// =============================================================================
// Cursor pagination yardımcısı — yüksek hacimli tablolar için
// =============================================================================
// Offset pagination büyük tablolarda yavaşlar (`OFFSET 50000` → 50k satır
// taranır sonra atlanır). Cursor pagination "son gördüğüm kayıttan sonrakini
// ver" mantığıyla çalışır — N kayıt taranır, **toplam tablo boyutu fark
// etmez**. Tradeoff: rastgele sayfaya atlama yok (sayfa 100'e doğrudan
// gidemezsin), sadece "Daha Fazla Yükle".
//
// Önerilen kullanım: SystemLog, Roll, RollMovement, RollOperation gibi
// 100k+ büyüyen tablolarda. Liste sayfaları zaman bazlı gösterimde olduğunda.
//
// Cursor formatı: base64( "<ISO date>__<uuid>" )
//   Tarih sıralaması (createdAt DESC) birincil, ID ikincil — aynı millisaniyede
//   eklenen kayıtlar için tie-breaker. UUID lexicographic ordered.
// =============================================================================

export interface Cursor {
  createdAt: Date;
  id: string;
}

const SEP = "__";

/** İki alanlı cursor'ı opak string'e çevir (URL-safe base64). */
export function encodeCursor(cursor: Cursor): string {
  const raw = `${cursor.createdAt.toISOString()}${SEP}${cursor.id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/** Opak cursor string'ini parse et. Geçersizse null. */
export function decodeCursor(token: string | undefined): Cursor | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const [iso, id] = raw.split(SEP);
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Prisma where clause'una cursor koşulu ekler.
 *
 * createdAt DESC sıralaması için:
 *   (createdAt < $cursor.createdAt) OR (createdAt = $cursor.createdAt AND id < $cursor.id)
 *
 * Bu desen tie-breaker garantisi sunar (aynı tarihte eklenen kayıtlar
 * arasında kararlı sıralama).
 */
export function cursorWhere(cursor: Cursor): {
  OR: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
} {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * Sayfanın sonundaki kaydın cursor'ını üret. Daha fazla kayıt yoksa null.
 *
 * Kullanım deseni:
 *   const items = await prisma.x.findMany({ ..., take: limit + 1 });
 *   const hasMore = items.length > limit;
 *   const data = hasMore ? items.slice(0, limit) : items;
 *   const nextCursor = hasMore ? buildNextCursor(data[data.length - 1]) : null;
 */
export function buildNextCursor(
  lastItem: { id: string; createdAt: Date } | undefined
): string | null {
  if (!lastItem) return null;
  return encodeCursor({ createdAt: lastItem.createdAt, id: lastItem.id });
}

// =============================================================================
// Generic (dinamik) cursor — keyfi sortBy / sortOrder destekli.
// Yukarıdaki createdAt-only cursor base.service'te artık bu fonksiyonlarla
// genelleştirildi. Diğer service'ler (workorder/inventory) hâlâ eski
// createdAt-cursor kullanıyor — onlara dokunulmadı.
// =============================================================================

const NULL_MARKER = "\u0000NULL\u0000";

export interface DynamicCursor {
  /** sortBy kolonunun serileştirilmiş değeri. null = NULL_MARKER. */
  v: string | null;
  id: string;
}

export function encodeDynamicCursor(c: DynamicCursor): string {
  const v = c.v === null ? NULL_MARKER : c.v;
  return Buffer.from(`${v}${SEP}${c.id}`, "utf8").toString("base64url");
}

export function decodeDynamicCursor(token: string | undefined): DynamicCursor | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const idx = raw.lastIndexOf(SEP);
    if (idx === -1) return null;
    const vStr = raw.slice(0, idx);
    const id = raw.slice(idx + SEP.length);
    if (!id) return null;
    return { v: vStr === NULL_MARKER ? null : vStr, id };
  } catch {
    return null;
  }
}

/**
 * Cursor'daki string değeri Prisma'nın anlayacağı tipe dönüştürür.
 * ISO date pattern → Date, sayı → number, aksi halde string.
 */
function coerceCursorValue(v: string): unknown {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

/**
 * Dinamik cursor için where clause.
 *
 * asc:  (field > val) OR (field = val AND id > cursor.id)
 * desc: (field < val) OR (field = val AND id < cursor.id)
 *
 * Null cursor değeri: nulls-last varsayımıyla, null grubu içinde id ile devam.
 * (Nullable kolonların tam doğru sayfalaması Phase 1 kapsamında değil — null
 * sayısı az olduğunda çalışır; uç durumda offset mode'a düşmek gerekebilir.)
 */
export function dynamicCursorWhere(
  cursor: DynamicCursor,
  sortField: string,
  sortOrder: "asc" | "desc",
): Record<string, unknown> {
  const op = sortOrder === "asc" ? "gt" : "lt";

  if (cursor.v === null) {
    return {
      [sortField]: null,
      id: { [op]: cursor.id },
    };
  }

  const typed = coerceCursorValue(cursor.v);

  return {
    OR: [
      { [sortField]: { [op]: typed } },
      {
        AND: [{ [sortField]: typed }, { id: { [op]: cursor.id } }],
      },
    ],
  };
}

export function buildNextDynamicCursor(
  lastItem: Record<string, unknown> | undefined,
  sortField: string,
): string | null {
  if (!lastItem) return null;
  const v = lastItem[sortField];
  let serialized: string | null;
  if (v === null || v === undefined) serialized = null;
  else if (v instanceof Date) serialized = v.toISOString();
  else serialized = String(v);
  return encodeDynamicCursor({ v: serialized, id: lastItem.id as string });
}
