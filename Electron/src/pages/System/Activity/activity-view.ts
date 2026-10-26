import type { ExportColumn } from "@/lib/list-export";
import { safeFormat } from "@/lib/format";
import type {
  SystemLogDomainAction,
  SystemLogGun,
  SystemLogIslem,
  SystemLogListItem,
  SystemLogListParams,
} from "@/types/systemLog";
import { actionLabel, tableLabel } from "./labels";

// Etkinlik akışının saf mantığı (izlenebilirlik B3). SÜZME SUNUCUDA: her süzgeç
// burada sorgu parametresine çevrilir; istemci dönen listeyi süzmez/saymaz
// (bekçi: activity-view.test — Activity*.tsx'te `.filter(` yok).

export type ActivityView = "islem" | "satir";

export interface ActivityFilterState {
  gorunum?: ActivityView;
  gun?: SystemLogGun;
  q?: string;
  userId?: string;
  tableName?: string;
  action?: SystemLogDomainAction;
  dateFrom?: string;
  dateTo?: string;
  /** "Reddedilenler" çipi — süzme SUNUCUDA (`reddedilen=1`). */
  reddedilen?: boolean;
}

export type FeedItem = SystemLogIslem | SystemLogListItem;

/** Sunucu sözleşmesi: `q` < 2 karakter Zod'da 400 olur — kısa terim gönderilmez. */
export const MIN_QUERY_LENGTH = 2;

export function buildFeedParams(f: ActivityFilterState, cursor: string | undefined, limit: number): SystemLogListParams {
  const q = f.q?.trim();
  const islem = (f.gorunum ?? "islem") === "islem";
  const aranan = q && q.length >= MIN_QUERY_LENGTH ? q : undefined;
  return {
    category: "DOMAIN", // AUTH/SYSTEM olayları Sistem Kayıtları sayfasında
    gorunum: islem ? "islem" : undefined,
    // Süzgeç yalnız İşlemler görünümünde ve arama yokken anlamlıdır (sunucu sözleşmesi).
    reddedilen: f.reddedilen && islem && !aranan ? 1 : undefined,
    gun: f.gun,
    q: aranan,
    userId: f.userId,
    tableName: f.tableName,
    action: f.action,
    // Gün çipi seçiliyse aralığı sunucu (fabrika günü) belirler.
    dateFrom: f.gun ? undefined : f.dateFrom,
    dateTo: f.gun ? undefined : f.dateTo,
    cursor,
    limit,
  };
}

export function isIslemItem(x: FeedItem): x is SystemLogIslem {
  return "kayitSayisi" in x && "satirlar" in x;
}

/**
 * Ekranda gerçekte hangi görünüm var? İşlem istendi ama sunucu satır döndürdüyse
 * (eski backend `gorunum`u yok sayar) ya da `q` araması satır döndürdüyse "satir".
 */
export function effectiveView(requested: ActivityView, items: readonly FeedItem[]): ActivityView {
  if (requested === "satir") return "satir";
  const first = items[0];
  return first && !isIslemItem(first) ? "satir" : "islem";
}

export function itemUser(i: FeedItem): string {
  return i.user ? i.user.fullName || i.user.username : "Sistem";
}

/** Eski backend düşüşündeki cümle (anlatı yoksa). */
export function legacySummary(i: SystemLogListItem): string {
  return `${itemUser(i)} → ${tableLabel(i.tableName)} kaydını ${actionLabel(i.action)}`;
}

/** "Açıklama" kolonu: sunucunun anlatısı; yoksa eski özet. */
export function itemDescription(i: FeedItem): string {
  if (i.anlati?.metin) return i.anlati.metin;
  return isIslemItem(i) ? itemUser(i) : legacySummary(i);
}

export const ACTIVITY_EXPORT_COLUMNS: ExportColumn<FeedItem>[] = [
  { label: "Tarih / Saat", value: (i) => safeFormat(i.createdAt, "dd.MM.yyyy HH:mm:ss") },
  { label: "Kullanıcı", value: itemUser },
  { label: "Açıklama", value: itemDescription },
  { label: "Modül", value: (i) => (isIslemItem(i) ? tableLabel(i.satirlar[0]?.tableName ?? "") : tableLabel(i.tableName)) },
  { label: "Etkilenen kayıt", value: (i) => (isIslemItem(i) ? i.kayitSayisi : 1) },
  { label: "Durum", value: (i) => (isIslemItem(i) && i.reddedildi ? "Reddedildi" : "Tamamlandı") },
  { label: "İşlem no", value: (i) => i.requestId ?? "" },
];

/** Boş akış metni: sunucu uyarısı → arama → Reddedilenler süzgeci → varsayılan. */
export function emptyFeedText(f: ActivityFilterState, warnings: readonly string[]): string | undefined {
  if (warnings[0]) return warnings[0];
  if (f.q) return "Bu numarada kayıt bulunamadı.";
  return f.reddedilen ? "Bu aralıkta reddedilen istek yok." : undefined;
}
