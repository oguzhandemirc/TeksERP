// =============================================================================
// Rota şablonu "iş emri kısayolu" (Gülkesim K6 / OIE sözleşme 1) — süzgeç, sıra ve gövde doğrulaması tek yerde
// =============================================================================
import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { PaginatedResponse } from "../../types/api.types";
import { AppError } from "../../utils/app-error";
import { TERIM } from "../../constants/terim";
import { KURSUN_DISPATCH_STATION_WHERE } from "./quality-station.helper";

/** Kısayol listesinin tavanı (sayfasız döner). */
export const SHORTCUT_LIST_MAX = 100;
/** Sıra: `shortcutOrder` ↑, ad ↑, id (eşitlik bozucu). */
export const SHORTCUT_ORDER_BY = [{ shortcutOrder: "asc" }, { name: "asc" }, { id: "asc" }] as const;

/** Yalnız `?shortcut=1` süzer; başka değer bugünkü listedir. */
export const isShortcutQuery = (req: Request): boolean => req.query.shortcut === "1";

/** Genel gövdeden yazılan iki skaler kolonun tipi — Prisma tip hatası 500 değil Türkçe 400 olsun. Sıra 0–9999 tam sayı. */
export function assertShortcutFields(data: Record<string, unknown>): void {
  if ("isWorkOrderShortcut" in data && typeof data.isWorkOrderShortcut !== "boolean") {
    throw AppError.badRequest(`${TERIM.terbiyeIsEmri.tekil} kısayolu evet/hayır olmalı`, { code: "VALIDATION_ERROR" });
  }
  if ("shortcutOrder" in data) {
    const v = data.shortcutOrder;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 9999) {
      throw AppError.badRequest("Kısayol sırası 0 ile 9999 arasında tam sayı olmalı", { code: "VALIDATION_ERROR" });
    }
  }
}

/** Kısayol listesi: sunucuda sıralı, sayfasız (kısayol az sayıdadır); where çağıranın `buildListWhere`inden. */
export async function listShortcutRoutes(where: Record<string, unknown>, include: unknown): Promise<PaginatedResponse<unknown>> {
  const data = await prisma.route.findMany({ where: where as Prisma.RouteWhereInput, orderBy: [...SHORTCUT_ORDER_BY], take: SHORTCUT_LIST_MAX, include: include as Prisma.RouteInclude });
  return { success: true, data, pagination: { page: 1, pageSize: SHORTCUT_LIST_MAX, total: data.length, totalPages: 1 } };
}

/** Verilen istasyonlardan kurşun istasyonu olanlar (`KURSUN_DISPATCH_STATION_WHERE`, tek sorgu) — `isKursunStation` alanının TEK türetmesi. */
export async function kursunStationIdSet(ids: ReadonlyArray<string>): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.station.findMany({ where: { id: { in: [...new Set(ids)] }, ...KURSUN_DISPATCH_STATION_WHERE }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

type StepWithStation = { station?: { id?: string; isKursunStation?: boolean } | null };

/**
 * Rota yanıtındaki her adım istasyonuna `isKursunStation` (kurşun yeteneği = `KURSUN_DISPATCH_STATION_WHERE`, tek sorgu).
 * İstemci gramaj alanını/varsayılanını buna bağlar; istasyon türünden (PROCESS_QC) yeniden hesaplamaz.
 */
export async function markKursunStations(routes: ReadonlyArray<unknown>): Promise<void> {
  const stations = routes.flatMap((r) => ((r as { steps?: StepWithStation[] } | null)?.steps ?? []).map((s) => s.station).filter((st): st is { id: string } => !!st?.id));
  if (stations.length === 0) return;
  const kursun = await kursunStationIdSet(stations.map((st) => st.id));
  for (const st of stations as Array<{ id: string; isKursunStation?: boolean }>) st.isKursunStation = kursun.has(st.id);
}

/** Yanıt sarmalı: liste (`data` dizi) ya da tekil (`data` nesne) aynı türetmeden geçer; yanıtı aynen döner. */
export async function withKursunStations<T extends { data?: unknown }>(res: T): Promise<T> {
  if (res.data) await markKursunStations(Array.isArray(res.data) ? res.data : [res.data]);
  return res;
}
