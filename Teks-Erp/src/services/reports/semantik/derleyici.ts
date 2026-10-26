// =============================================================================
// SEMANTİK KATMAN — DERLEYİCİ (R1-SEMCEK; plan §3.1 "Derleyici kuralları")
// =============================================================================
// Kullanıcı girdisinden SQL'e giden TEK yol. Kimlik (küp/ölçü/boyut) yalnız sözlükte ARANIR,
// asla SQL'e yazılmaz; süzgeç değerleri yalnız `Prisma.sql` parametresidir. Bilinmeyen kimlik
// 400 `SEMANTIK_ALAN_BILINMIYOR`, izin/modül eksiği 403 `SEMANTIK_IZIN_YOK` — sessiz düşürme yok.
// Kırılım tavanı + "Diğer" kovası ve toplam TAM kümeden (tavandan önce) aynı sorguda hesaplanır.
// =============================================================================
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../../utils/app-error";
import { factoryDayStartOfKey, factoryDaySql, factoryMonthSql, factoryWeekSql, factoryYmd } from "../../../constants/time";
import { REPORT_MAX_ROWS, resolveDateRange, type DateRange } from "../_shared";
import { canAccess, type AccessContext } from "./izin";
import { SEMANTIC_CUBES } from "./katalog";
import { andOnlyLeaves, buildFilterTree, compileTreeSql, expandBetween, filterLeaves, semanticFilterSchema, semanticJoinSchema, type SemanticFilterLeaf } from "./suzgec-agaci";

export { andOnlyLeaves, expandBetween, isFilterGroup, type SemanticFilterGroup, type SemanticFilterLeaf } from "./suzgec-agaci";
import {
  FILTER_OPERATORS,
  type CompiledFilter,
  type CompiledFilterGroup,
  type CompiledQuery,
  type PeriodSpec,
  type SemanticCube,
  type SemanticDimension,
  type SemanticMeasure,
} from "./tipler";

export const DEFAULT_BREAKDOWN_CAP = 50;
export const MAX_PERIODS = 12;
const MAX_DIMENSIONS = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export const semanticQuerySchema = z
  .object({
    kup: z.string().min(1).max(64),
    olculer: z.array(z.string().min(1).max(96)).min(1).max(8),
    boyutlar: z.array(z.string().min(1).max(64)).max(MAX_DIMENSIONS).default([]),
    // Kök bağlacı `suzgecBaglaci` (varsayılan "ve" — eski düz liste aynı anlamı korur).
    suzgec: semanticFilterSchema,
    suzgecBaglaci: semanticJoinSchema.optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    compare: z.enum(["none", "prev", "prevYear", "custom"]).optional(),
    compareFrom: z.string().datetime().optional(),
    compareTo: z.string().datetime().optional(),
    donemler: z
      .object({ birim: z.enum(["gun", "hafta", "ay"]), adet: z.number().int().min(1).max(MAX_PERIODS) })
      .strict()
      .optional(),
    tavan: z.number().int().min(1).max(DEFAULT_BREAKDOWN_CAP).optional(),
    yenile: z.boolean().optional(),
    kosuId: z.string().uuid().optional(),
  })
  .strict();

export type SemanticQueryInput = z.infer<typeof semanticQuerySchema>;

function unknownField(kind: string, name: string, extra?: string): AppError {
  return AppError.badRequest(`Tanınmayan ${kind}: "${name}"${extra ? ` — ${extra}` : ""}.`, {
    code: "SEMANTIK_ALAN_BILINMIYOR",
    alan: name,
    tur: kind,
  });
}

function unsupported(message: string, name: string): AppError {
  return AppError.badRequest(message, { code: "SEMANTIK_ALAN_DESTEKLENMIYOR", alan: name });
}

function noAccess(name: string): AppError {
  return AppError.forbidden(`"${name}" alanını görme yetkiniz yok ya da ait olduğu modül kapalı.`, {
    code: "SEMANTIK_IZIN_YOK",
    alan: name,
  });
}

/** `%` / `_` / `\` kaçışı — `contains` değeri desen değil düz metin olarak aranır. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function periodSql(unit: PeriodSpec["unit"], column: string): Prisma.Sql {
  if (unit === "gun") return factoryDaySql(column);
  if (unit === "hafta") return factoryWeekSql(column);
  return factoryMonthSql(column);
}

/** Son N fabrika dönemi: başlangıç ilk dönemin ilk fabrika günü, bitiş verilen an. */
export function resolvePeriodRange(spec: PeriodSpec, to: Date): DateRange {
  const [y, m, d] = factoryYmd(to).split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  if (spec.unit === "gun") day.setUTCDate(day.getUTCDate() - (spec.count - 1));
  else if (spec.unit === "hafta") day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) - 7 * (spec.count - 1));
  else {
    day.setUTCDate(1);
    day.setUTCMonth(day.getUTCMonth() - (spec.count - 1));
  }
  return { from: factoryDayStartOfKey(day.toISOString().slice(0, 10)), to };
}

function compileFilterSql(f: CompiledFilter): Prisma.Sql {
  const key = Prisma.sql`(${f.dimension.keySql})::text`;
  const list = (): Prisma.Sql => Prisma.join(f.values.map((v) => Prisma.sql`${v}`));
  switch (f.operator) {
    case "=":
      return Prisma.sql`${key} = ${f.values[0]}`;
    case "!=":
      return Prisma.sql`${key} IS DISTINCT FROM ${f.values[0]}`;
    case "in":
      // Boş liste hiçbir satırı tutmaz — `IN ()` yazılmaz.
      return f.values.length ? Prisma.sql`${key} IN (${list()})` : Prisma.sql`FALSE`;
    case "notIn":
      return f.values.length ? Prisma.sql`(${key} IS NULL OR ${key} NOT IN (${list()}))` : Prisma.sql`TRUE`;
    case "contains":
      return Prisma.sql`(${f.dimension.labelSql!}) ILIKE ${`%${escapeLike(f.values[0]!)}%`} ESCAPE '\\'`;
  }
}

function resolveFilter(
  raw: SemanticFilterLeaf,
  cube: SemanticCube,
  helperDims: readonly string[] | null,
  ctx: AccessContext,
): CompiledFilter {
  const dim = cube.dimensions.find((d) => d.id === raw.alan);
  if (!dim) throw unknownField("boyut", raw.alan, `"${cube.id}" küpünde böyle bir boyut yok`);
  if (helperDims && !helperDims.includes(dim.id)) throw unsupported(`"${dim.name}" bu ölçüde süzgeç olarak kullanılamaz.`, dim.id);
  if (!helperDims && dim.helperOnly) throw unsupported(`"${dim.name}" bu ölçüde süzgeç olarak kullanılamaz.`, dim.id);
  if (!canAccess(dim, ctx)) throw noAccess(dim.id);
  if (dim.kind === "time") throw unsupported(`"${dim.name}" süzgeci yerine tarih aralığı kullanın.`, dim.id);
  const values = Array.isArray(raw.deger) ? raw.deger : [raw.deger];
  if (raw.islec === "between") {
    if (!dim.ordered || helperDims) throw unsupported(`"${dim.name}" için "arasında" kullanılamaz.`, dim.id);
    if (values.length !== 2 || values.some((v) => !(dim.enumValues ?? []).includes(v))) {
      throw AppError.badRequest(`"${dim.name}" arasında süzgeci iki geçerli sınır ister.`, { code: "SEMANTIK_SUZGEC_GECERSIZ", alan: dim.id });
    }
    return { dimension: dim, operator: "in", values: expandBetween(dim, values[0]!, values[1]!) };
  }
  const single = raw.islec === "=" || raw.islec === "!=" || raw.islec === "contains";
  if (single && values.length !== 1) throw AppError.badRequest(`"${raw.islec}" işleci tek değer alır.`, { code: "SEMANTIK_SUZGEC_GECERSIZ", alan: dim.id });
  if (raw.islec === "contains") {
    if (!dim.labelSql || helperDims) throw unsupported(`"${dim.name}" içinde metin araması yapılamaz.`, dim.id);
  } else {
    for (const v of values) {
      const ok = dim.valueType === "uuid" ? UUID_RE.test(v) : (dim.enumValues ?? []).includes(v);
      if (!ok) throw AppError.badRequest(`"${dim.name}" süzgecinde geçersiz değer.`, { code: "SEMANTIK_SUZGEC_GECERSIZ", alan: dim.id });
    }
  }
  return { dimension: dim, operator: raw.islec, values };
}

function resolveFilterTree(input: SemanticQueryInput, cube: SemanticCube, helperDims: readonly string[] | null, ctx: AccessContext): CompiledFilterGroup {
  return buildFilterTree(input.suzgec, input.suzgecBaglaci, (r) => resolveFilter(r, cube, helperDims, ctx));
}

/** Kimlikleri çözer, izinleri denetler ve çalıştırılabilir sorguyu üretir. */
export function compileQuery(
  input: SemanticQueryInput,
  ctx: AccessContext,
  cubes: readonly SemanticCube[] = SEMANTIC_CUBES,
): CompiledQuery {
  const cube = cubes.find((c) => c.id === input.kup);
  if (!cube) throw unknownField("küp", input.kup);
  if (!canAccess(cube, ctx)) throw noAccess(cube.id);

  const measures: SemanticMeasure[] = [];
  for (const id of input.olculer) {
    const m = cube.measures.find((x) => x.id === id);
    if (!m) throw unknownField("ölçü", id, `"${cube.id}" küpünde böyle bir ölçü yok`);
    if (measures.includes(m)) throw unsupported(`"${id}" ölçüsü iki kez seçilmiş.`, id);
    if (!canAccess(m, ctx)) throw noAccess(id);
    if (m.kind === "ratio") {
      for (const part of [m.numerator, m.denominator]) {
        const p = cube.measures.find((x) => x.id === part);
        if (!p || !canAccess(p, ctx)) throw noAccess(id);
      }
    }
    measures.push(m);
  }
  const helper = measures.find((m) => m.kind === "helper");
  if (helper && measures.length > 1) {
    throw AppError.badRequest(`"${helper.id}" ölçüsü başka ölçülerle aynı sorguda istenemez.`, { code: "SEMANTIK_OLCU_BIRLESMEZ", alan: helper.id });
  }
  const helperDims = helper ? helper.helper!.dimensions : null;

  const dimensions: SemanticDimension[] = [];
  for (const id of input.boyutlar) {
    const d = cube.dimensions.find((x) => x.id === id);
    if (!d) throw unknownField("boyut", id, `"${cube.id}" küpünde böyle bir boyut yok`);
    if (dimensions.includes(d)) throw unsupported(`"${id}" boyutu iki kez seçilmiş.`, id);
    if (helperDims && !helperDims.includes(d.id)) throw unsupported(`"${helper!.id}" ölçüsü "${d.name}" kırılımını desteklemiyor.`, id);
    if (!helperDims && d.helperOnly) throw unsupported(`"${d.name}" kırılımı yalnız bu boyutu destekleyen ölçülerle kullanılabilir.`, id);
    if (!canAccess(d, ctx)) throw noAccess(id);
    dimensions.push(d);
  }
  if (dimensions.filter((d) => d.kind === "time").length > 1) {
    throw AppError.badRequest("En fazla bir zaman boyutu seçilebilir.", { code: "SEMANTIK_ALAN_DESTEKLENMIYOR", alan: "zaman" });
  }
  const period: PeriodSpec | null = input.donemler ? { unit: input.donemler.birim, count: input.donemler.adet } : null;
  if (period && (helper || dimensions.some((d) => d.kind === "time"))) {
    throw AppError.badRequest("Çok dönemli kıyas zaman boyutuyla ya da bu ölçüyle birlikte kullanılamaz.", { code: "SEMANTIK_ALAN_DESTEKLENMIYOR", alan: "donemler" });
  }

  const filter = resolveFilterTree(input, cube, helperDims, ctx);
  if (helper && !andOnlyLeaves(filter)) throw unsupported(`"${helper.id}" ölçüsünde "veya" süzgeci kullanılamaz; koşulları "ve" ile bağlayın.`, helper.id);
  const range = period
    ? resolvePeriodRange(period, input.dateTo ? new Date(input.dateTo) : new Date())
    : resolveDateRange({ dateFrom: input.dateFrom, dateTo: input.dateTo });
  const cap = input.tavan ?? DEFAULT_BREAKDOWN_CAP;

  return {
    cube,
    measures,
    dimensions,
    filter,
    period,
    cap,
    range,
    sql: helper ? null : buildSql({ cube, measures, dimensions, filter, period, cap, range }),
  };
}

/** Kümelenecek ham toplamlar: doğrudan `sum` ölçüler + oranların pay/paydası (tekilleştirilmiş). */
export function sumColumns(cube: SemanticCube, measures: readonly SemanticMeasure[]): SemanticMeasure[] {
  const out: SemanticMeasure[] = [];
  const add = (m: SemanticMeasure | undefined): void => {
    if (m && m.kind === "sum" && !out.includes(m)) out.push(m);
  };
  for (const m of measures) {
    if (m.kind === "sum") add(m);
    else if (m.kind === "ratio") {
      add(cube.measures.find((x) => x.id === m.numerator));
      add(cube.measures.find((x) => x.id === m.denominator));
    }
  }
  return out;
}

/** `Prisma.join` boş diziyi reddeder — boş parça boş SQL'dir. */
function joinOrEmpty(parts: readonly Prisma.Sql[], sep: string): Prisma.Sql {
  return parts.length ? Prisma.join(parts, sep) : Prisma.empty;
}

type SqlParts = Pick<CompiledQuery, "cube" | "measures" | "dimensions" | "filter" | "period" | "cap" | "range">;

/**
 * Tek ifade: `g` = süzülmüş tam küme gruplaması; `r<i>` = kategori boyutunun tam kümeden sırası;
 * satırlar tavanla "Diğer"e katlanır, `total` satırları `g`den (tavandan ÖNCE) gelir.
 */
export function buildSql(q: SqlParts): Prisma.Sql {
  const sums = sumColumns(q.cube, q.measures);
  const joins = new Set<Prisma.Sql>();
  for (const d of [...q.dimensions, ...filterLeaves(q.filter).map((f) => f.dimension)]) if (d.joins) joins.add(d.joins);
  const gSelect: Prisma.Sql[] = [];
  q.dimensions.forEach((d, i) => {
    gSelect.push(Prisma.sql`(${d.keySql})::text AS ${Prisma.raw(`k${i}`)}`);
    gSelect.push(Prisma.sql`${d.labelSql ?? Prisma.sql`NULL`}::text AS ${Prisma.raw(`l${i}`)}`);
  });
  const groupCount = gSelect.length + (q.period ? 1 : 0);
  if (q.period) gSelect.push(Prisma.sql`(${periodSql(q.period.unit, q.cube.timeColumn)})::text AS per`);
  else gSelect.push(Prisma.sql`NULL::text AS per`);
  // Boş küme toplamı 0'dır (gruplamasız sorguda SUM tek NULL satır döner).
  sums.forEach((m, j) => gSelect.push(Prisma.sql`COALESCE((${m.sql!})::float, 0) AS ${Prisma.raw(`s${j}`)}`));
  const cond = compileTreeSql(q.filter, compileFilterSql);
  const where = cond ? Prisma.sql`WHERE ${cond}` : Prisma.empty;
  const groupBy = groupCount
    ? Prisma.sql`GROUP BY ${Prisma.raw(Array.from({ length: groupCount }, (_, i) => String(i + 1)).join(", "))}`
    : Prisma.empty;

  const capped = q.dimensions.map((d) => d.kind === "category");
  const rankCtes = q.dimensions.flatMap((_d, i) =>
    capped[i]
      ? [Prisma.raw(`, r${i} AS (SELECT k${i}, ROW_NUMBER() OVER (ORDER BY SUM(${sums.length ? "s0" : "1"}) DESC NULLS LAST, k${i} NULLS LAST) AS rn FROM g GROUP BY k${i})`)]
      : [],
  );
  const rowCols: string[] = [];
  const rowGroup: string[] = [];
  q.dimensions.forEach((_d, i) => {
    if (capped[i]) {
      rowCols.push(`CASE WHEN r${i}.rn <= ${q.cap} THEN g.k${i} END AS k${i}`);
      rowCols.push(`CASE WHEN r${i}.rn <= ${q.cap} THEN g.l${i} ELSE 'Diğer' END AS l${i}`);
      rowCols.push(`(r${i}.rn > ${q.cap}) AS o${i}`);
    } else {
      rowCols.push(`g.k${i} AS k${i}`, `g.l${i} AS l${i}`, `FALSE AS o${i}`);
    }
  });
  rowCols.push("g.per AS per");
  for (let n = 1; n <= rowCols.length; n++) rowGroup.push(String(n + 1));
  const sumCols = sums.map((_m, j) => `SUM(g.s${j})::float AS s${j}`);
  const rankJoins = q.dimensions
    .map((_d, i) => (capped[i] ? ` LEFT JOIN r${i} ON r${i}.k${i} IS NOT DISTINCT FROM g.k${i}` : ""))
    .join("");
  const totalCols = q.dimensions.flatMap((_d, i) => [`NULL::text AS k${i}`, `NULL::text AS l${i}`, `FALSE AS o${i}`]);
  const rowSelect = Prisma.raw(
    `SELECT 'row' AS kind, ${[...rowCols, ...sumCols].join(", ")} FROM g${rankJoins} GROUP BY ${rowGroup.join(", ")}`,
  );
  const totalSelect = Prisma.raw(
    `SELECT 'total' AS kind, ${[...totalCols, "g.per AS per", ...sumCols].join(", ")} FROM g GROUP BY g.per`,
  );
  const order = sums.length ? "s0 DESC NULLS LAST" : "per";
  return Prisma.sql`WITH g AS (SELECT ${Prisma.join(gSelect)} FROM ${q.cube.source(q.range)} ${joinOrEmpty([...joins], " ")} ${where} ${groupBy})${joinOrEmpty(rankCtes, "")}
SELECT * FROM (${rowSelect} UNION ALL ${totalSelect}) u
ORDER BY (kind = 'total') DESC, per NULLS FIRST, ${Prisma.raw(order)}
LIMIT ${Prisma.raw(String(REPORT_MAX_ROWS + MAX_PERIODS + 2))}`;
}
