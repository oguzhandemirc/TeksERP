// Gelen kutusu liste süzgeçleri (plan §5.6; N4-TABLET eki). Süzme SUNUCUDA: istemci (panel gün özeti
// kartı, tablet çekmecesi/şeridi) yalnız parametre gönderir. Tanınmayan süzgeç adı/değeri 400 (fail-closed).
import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { readFilterList } from "../../utils/query-parser";
import { NOTIFICATION_KINDS, getNotificationEntry, type NotificationKind } from "../../constants/notification-catalog";

const KNOWN_FILTERS = ["filter[tur]", "filter[ozet]", "filter[tablet]", "filter[kanal]"] as const;
/** `filter[kanal]` yalnız tablet sesli kanalını tanır: tabletin gelen kutusu bu kanalı taşıyan türleri gösterir. */
const LIST_CHANNELS = ["TABLET_SES"] as const;

export interface InboxListFilter {
  kindFilter: string[];
  /** Satırın `ozet` bayrağı (gün özeti satırı mı). */
  ozet?: boolean;
  /** Satırın `kanalTablet` bayrağı (sessiz saat sunucuda çözülmüş tablet sesi/şeridi). */
  tablet?: boolean;
  /** Katalog kanalı: türün `kanallar`ında bu kanal var mı. */
  kanal?: (typeof LIST_CHANNELS)[number];
}

function readBool(query: Record<string, unknown>, key: string): boolean | undefined {
  const raw = query[key];
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw AppError.badRequest(`Süzgeç değeri tanınmıyor: ${key} (true | false)`, { code: "INVALID_FILTER", params: [key] });
}

/** `filter[...]` dışındaki süzgeç adı tanınmaz; çıplak `tur` ve katalog dışı tür 400 (fail-closed). */
export function readInboxListFilter(query: Record<string, unknown>): InboxListFilter {
  if ("tur" in query) {
    throw AppError.badRequest("Süzgeç çıplak gönderilemez: `tur` — `filter[tur]=…` biçimini kullanın.", { code: "BARE_FILTER_PARAM", params: ["tur"] });
  }
  const unknownFilters = Object.keys(query).filter((k) => k.startsWith("filter[") && !(KNOWN_FILTERS as readonly string[]).includes(k));
  if (unknownFilters.length) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknownFilters.join(", ")}`, { code: "INVALID_FILTER" });
  const kindFilter = readFilterList(query["filter[tur]"] as string | string[] | undefined);
  const unknownKinds = kindFilter.filter((t) => !(NOTIFICATION_KINDS as readonly string[]).includes(t));
  if (unknownKinds.length) throw AppError.badRequest(`Tanınmayan bildirim türü: ${unknownKinds.join(", ")}`, { code: "UNKNOWN_KIND" });
  const kanalRaw = query["filter[kanal]"];
  if (kanalRaw !== undefined && !(LIST_CHANNELS as readonly unknown[]).includes(kanalRaw)) {
    throw AppError.badRequest("Süzgeç değeri tanınmıyor: filter[kanal] (TABLET_SES)", { code: "INVALID_FILTER", params: ["filter[kanal]"] });
  }
  return {
    kindFilter,
    ozet: readBool(query, "filter[ozet]"),
    tablet: readBool(query, "filter[tablet]"),
    kanal: kanalRaw as InboxListFilter["kanal"],
  };
}

/** Görme kümesini tür/kanal süzgeciyle KESİŞTİRİR (süzgeç yetki genişletmez). */
export function narrowKinds(kinds: readonly string[], f: Pick<InboxListFilter, "kindFilter" | "kanal">): string[] {
  let out = f.kindFilter.length ? kinds.filter((k) => f.kindFilter.includes(k)) : [...kinds];
  if (f.kanal) out = out.filter((k) => getNotificationEntry(k as NotificationKind).kanallar.includes(f.kanal!));
  return out;
}

/** Satır bayrağı süzgeçleri — `buildInboxWhere`in AND'ine girer. */
export function rowFlagWhere(f: Pick<InboxListFilter, "ozet" | "tablet">): Prisma.NotificationInboxWhereInput[] {
  const out: Prisma.NotificationInboxWhereInput[] = [];
  if (f.ozet !== undefined) out.push({ ozet: f.ozet });
  if (f.tablet !== undefined) out.push({ kanalTablet: f.tablet });
  return out;
}
