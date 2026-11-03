// =============================================================================
// Kumaş özelliği listesinin HİYERARŞİ sırası (K21, `?sortBy=hierarchy`)
// =============================================================================
// Çeşit (`variantOfPropertyId`; Kurşunlu → KURŞUN GRAMAJI) ebeveyn bayrağının HEMEN
// altında gelir. Sunucuda kurulur çünkü panel listesi cursor'lıdır: istemci sıralaması
// ve "eşleşen çeşidin ebeveyni" bağlamı yalnız yüklü sayfayı görürdü (filtre-liste.md).
// Derinlik 1: çeşit SEÇİM, ebeveyn BAYRAK, bir bayrağın tek çeşidi (property-variant.helper).
// Eski istemci bu sortBy'ı göndermez → BaseService yolu bayt-aynı.
// =============================================================================
import type { Request } from "express";
import { AppError } from "../../utils/app-error";
import { decodeOffsetCursor, encodeOffsetCursor } from "../../utils/cursor";
import { isCursorRequested, parseQueryParams } from "../../utils/query-parser";
import type { PaginatedResponse, QueryParams } from "../../types/api.types";
import type { CursorPaginatedResponse } from "../base.service";

export const HIERARCHY_SORT = "hierarchy";
/** Ana veri ölçeği (onlarca satır); aşılırsa sessiz kesik yerine 400 — süzgeç daraltılır. */
export const HIERARCHY_MAX_ROWS = 2000;

export interface HierarchyNode {
  id: string;
  name: string;
  sortOrder: number;
  variantOfPropertyId: string | null;
}

/** `listLevel` 1 = çeşit satırı (girintili); `listContext` = süzgece uymadı, eşleşen çeşidin bağlamı (soluk). */
export type HierarchyRow<T> = T & { listLevel: 0 | 1; listContext: boolean };

function compareNodes(dir: "asc" | "desc") {
  const sign = dir === "asc" ? 1 : -1;
  return (a: HierarchyNode, b: HierarchyNode): number =>
    (a.sortOrder - b.sortOrder) * sign || a.name.localeCompare(b.name, "tr") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Saf ağaç sırası: kökler sortOrder → ad (tr) → id; her kökün çeşit(ler)i hemen altında. */
export function orderHierarchy<T extends HierarchyNode>(rows: T[], contextIds: ReadonlySet<string>, dir: "asc" | "desc" = "asc"): HierarchyRow<T>[] {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const r of byId.values()) {
    const parent = r.variantOfPropertyId;
    if (parent && byId.has(parent)) children.set(parent, [...(children.get(parent) ?? []), r]);
    else roots.push(r);
  }
  const cmp = compareNodes(dir);
  const out: HierarchyRow<T>[] = [];
  for (const root of roots.sort(cmp)) {
    out.push({ ...root, listLevel: 0, listContext: contextIds.has(root.id) });
    for (const c of (children.get(root.id) ?? []).sort(cmp)) out.push({ ...c, listLevel: 1, listContext: contextIds.has(c.id) });
  }
  return out;
}

export interface HierarchyDeps {
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  include?: Record<string, unknown>;
  /** Liste where'i (süzgeç + arama) ve aramasız hâli — ikisi de `buildListWhere`ten. */
  buildWhere: (params: QueryParams) => Record<string, unknown>;
}

/**
 * Eşleşenler + eşleşen çeşidin ebeveyni (bağlam, süzgeçsiz) + eşleşen ebeveynin çeşitleri
 * (süzgeci geçen; arama ebeveyne uyduysa çeşit de altında görünür). Sayfalama ağaç üzerinde.
 */
export async function listFabricPropertyHierarchy(
  req: Request,
  deps: HierarchyDeps,
): Promise<PaginatedResponse<unknown> | CursorPaginatedResponse<unknown>> {
  const params = parseQueryParams(req);
  const inc = deps.include ? { include: deps.include } : {};
  const matched = (await deps.findMany({ where: deps.buildWhere(params), take: HIERARCHY_MAX_ROWS + 1, ...inc })) as HierarchyNode[];
  if (matched.length > HIERARCHY_MAX_ROWS) {
    throw AppError.badRequest(`Ağaç görünümü en fazla ${HIERARCHY_MAX_ROWS} özellik gösterir — süzgeci daraltın ya da bir sütuna göre sıralayın.`);
  }
  const have = new Set(matched.map((r) => r.id));
  const parentIds = [...new Set(matched.map((r) => r.variantOfPropertyId).filter((p): p is string => !!p && !have.has(p)))];
  const rootIds = matched.filter((r) => !r.variantOfPropertyId).map((r) => r.id);
  const or: Record<string, unknown>[] = [];
  if (parentIds.length > 0) or.push({ id: { in: parentIds } });
  if (rootIds.length > 0) or.push({ AND: [deps.buildWhere({ ...params, search: undefined }), { variantOfPropertyId: { in: rootIds } }] });
  const extra = or.length > 0 ? ((await deps.findMany({ where: { OR: or }, ...inc })) as HierarchyNode[]) : [];
  const fresh = extra.filter((r) => !have.has(r.id));
  const contextIds = new Set(fresh.filter((r) => parentIds.includes(r.id)).map((r) => r.id));
  const dir = req.query.sortOrder === "desc" ? "desc" : "asc";
  const tree = orderHierarchy([...matched, ...fresh], contextIds, dir);
  return paginateTree(req, params, tree);
}

function paginateTree(
  req: Request,
  params: QueryParams,
  tree: unknown[],
): PaginatedResponse<unknown> | CursorPaginatedResponse<unknown> {
  if (!isCursorRequested(req)) {
    const skip = (params.page - 1) * params.pageSize;
    return {
      success: true,
      data: tree.slice(skip, skip + params.pageSize),
      pagination: { page: params.page, pageSize: params.pageSize, total: tree.length, totalPages: Math.ceil(tree.length / params.pageSize) },
    };
  }
  const limit = Math.min(Math.max(1, parseInt(req.query.limit as string, 10) || 50), 200);
  const offset = decodeOffsetCursor(req.query.cursor as string | undefined);
  const hasMore = tree.length > offset + limit;
  return {
    success: true,
    data: tree.slice(offset, offset + limit),
    pagination: {
      nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
      hasMore,
      limit,
      ...(req.query.withTotal === "true" ? { totalEstimate: tree.length } : {}),
    },
  };
}
