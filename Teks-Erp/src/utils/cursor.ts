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

/** Cursor değer tipi etiketi: s=string, n=number/Decimal, d=Date, b=boolean. */
export type CursorValueTag = "s" | "n" | "d" | "b";

export interface DynamicCursor {
  /** sortBy kolonunun serileştirilmiş değeri. null = sıralama kolonu NULL. */
  v: string | null;
  id: string;
  /** Değer tipi — decode tarafında TAHMİN yerine bu kullanılır. Eski (etiketsiz)
   *  token'larda yoktur; geriye-uyum için coerceCursorValue fallback'i kalır. */
  t?: CursorValueTag;
}

export function encodeDynamicCursor(c: DynamicCursor): string {
  // JSON format (v2): tip etiketi taşır. Eski `v__id` formatı decode'da hâlâ kabul edilir.
  return Buffer.from(JSON.stringify({ v: c.v, id: c.id, t: c.t }), "utf8").toString(
    "base64url",
  );
}

export function decodeDynamicCursor(token: string | undefined): DynamicCursor | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    // v2 (JSON) format
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as { v?: unknown; id?: unknown; t?: unknown };
      if (typeof parsed.id !== "string" || !parsed.id) return null;
      const v =
        parsed.v === null || typeof parsed.v === "string"
          ? (parsed.v as string | null)
          : null;
      const t =
        parsed.t === "s" || parsed.t === "n" || parsed.t === "d" || parsed.t === "b"
          ? (parsed.t as CursorValueTag)
          : undefined;
      return { v, id: parsed.id, t };
    }
    // v1 (legacy) format: `v__id`
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
 * Cursor'daki string değeri Prisma'nın anlayacağı tipe dönüştürür — yalnız
 * etiketsiz LEGACY token'lar için tahmin. Tip etiketi varsa typedFromTag
 * kullanılır: '10245' gibi tamamen rakamsal ürün/renk kodlarının number'a
 * çevrilip string kolonda PrismaClientValidationError (2. sayfa 400) üretmesi
 * böylece engellenir.
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

function typedFromTag(tag: CursorValueTag, v: string): unknown {
  switch (tag) {
    case "d": {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? v : d;
    }
    case "n": {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    case "b":
      return v === "true";
    default:
      return v;
  }
}

/**
 * Dinamik cursor için where clause.
 *
 * asc:  (field > val) OR (field = val AND id > cursor.id)
 * desc: (field < val) OR (field = val AND id < cursor.id)
 *
 * NULLABLE sıralama kolonu (`sortNullable=true` — orderBy `nulls:'last'` İLE
 * birlikte kullanılmalı): null grubu her iki yönde de EN SONA gelir; non-null
 * fazın where'ine `OR {field: null}` dalı eklenir ki sayfa sınırı non-null
 * grubun sonuna gelince null kuyruğuna geçilebilsin. (Eskiden gt/lt üç-değerli
 * mantıkta NULL satırları elediği için kuyruk sessizce düşüyordu; DESC'te ise
 * Postgres default NULLS FIRST cursor'ı null grubuna kilitleyip non-null
 * kayıtların TAMAMINI yutuyordu.)
 */
export function dynamicCursorWhere(
  cursor: DynamicCursor,
  sortField: string,
  sortOrder: "asc" | "desc",
  sortNullable = false,
): Record<string, unknown> {
  const op = sortOrder === "asc" ? "gt" : "lt";

  if (cursor.v === null) {
    // Null fazı: nulls-last sıralamada null grubu SON grup — id ile devam.
    return {
      [sortField]: null,
      id: { [op]: cursor.id },
    };
  }

  const typed = cursor.t ? typedFromTag(cursor.t, cursor.v) : coerceCursorValue(cursor.v);

  const branches: Record<string, unknown>[] = [
    { [sortField]: { [op]: typed } },
    {
      AND: [{ [sortField]: typed }, { id: { [op]: cursor.id } }],
    },
  ];
  if (sortNullable) {
    // Non-null faz bitince null kuyruğuna geçiş (nulls-last ile null'lar "sonra").
    branches.push({ [sortField]: null });
  }

  return { OR: branches };
}

export function buildNextDynamicCursor(
  lastItem: Record<string, unknown> | undefined,
  sortField: string,
): string | null {
  if (!lastItem) return null;
  const v = lastItem[sortField];
  let serialized: string | null;
  let tag: CursorValueTag | undefined;
  if (v === null || v === undefined) {
    serialized = null;
  } else if (v instanceof Date) {
    serialized = v.toISOString();
    tag = "d";
  } else if (typeof v === "boolean") {
    serialized = String(v);
    tag = "b";
  } else if (typeof v === "number") {
    serialized = String(v);
    tag = "n";
  } else if (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { toNumber?: unknown }).toNumber === "function"
  ) {
    // Prisma.Decimal (duck-type — bu util prisma'ya bağımlı değil)
    serialized = String(v);
    tag = "n";
  } else {
    serialized = String(v);
    tag = "s";
  }
  return encodeDynamicCursor({ v: serialized, id: lastItem.id as string, t: tag });
}

// =============================================================================
// Offset-encoded cursor — ilişki / aggregate sıralaması için.
// İlişki (customer.name) veya aggregate (lines _count) sıralamasında keyset
// imkansızdır (cursor değeri satırın top-level skaler kolonu olmalı). Bu
// durumda findAllCursor offset'e düşer; cursor token'ı opak offset taşır.
// Frontend infinite-query nextCursor'ı opak gördüğü için pagination katmanı
// değişmez. Değerler her zaman canlı-doğru (denormalize kolon yok).
// =============================================================================

const OFFSET_MARKER = "o";

export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`${OFFSET_MARKER}${SEP}${offset}`, "utf8").toString("base64url");
}

export function decodeOffsetCursor(token: string | undefined): number {
  if (!token) return 0;
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const [marker, n] = raw.split(SEP);
    if (marker !== OFFSET_MARKER) return 0;
    const off = parseInt(n, 10);
    return Number.isFinite(off) && off > 0 ? off : 0;
  } catch {
    return 0;
  }
}
