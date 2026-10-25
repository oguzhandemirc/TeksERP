// =============================================================================
// YAZDIRMA GEÇMİŞİ SÜZGECİ — URL ↔ süzgeç durumu ↔ `GET /api/print-jobs` parametresi (A3)
// =============================================================================
// Süzme SUNUCUDADIR: bu dosya yalnız parametreyi kurar. Gün çipleri FABRİKA gününden
// anahtar üretir (`gunBas`/`gunBit` = yyyy-MM-dd); sınırı backend `resolveRange*` çözer.
// =============================================================================
import { addDaysToKey, factoryDayKey } from "@/lib/factory-time";
import type { PrintOutputKind, PrintSource, PrintStatus, PrintSubjectKind } from "@/services/printHistoryService";

export type PrintDayChip = "bugun" | "dun" | "hafta" | "aralik" | "tumu";

export interface PrintHistoryFilterState {
  gun: PrintDayChip;
  /** Yalnız `gun === "aralik"`. */
  gunBas?: string;
  gunBit?: string;
  userId?: string;
  /** Yazıcı: kayıtlı cihaz kimliği (UUID) ya da çıplak yazıcı adı — bildirim derin bağlantısı da bunu taşır. */
  printer?: string;
  deviceRefId?: string;
  subjectKind?: PrintSubjectKind;
  status?: PrintStatus;
  outputKind?: PrintOutputKind;
  source?: PrintSource;
  subjectId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CHIPS: readonly PrintDayChip[] = ["bugun", "dun", "hafta", "aralik", "tumu"];

export const isUuid = (v: string | undefined | null): v is string => !!v && UUID_RE.test(v);

/** Fabrika haftasının (Pazartesi) ilk günü. Takvim günü dilimden bağımsızdır → UTC hafta günü. */
export function weekStartKey(dayKey: string): string {
  const dow = new Date(`${dayKey}T00:00:00Z`).getUTCDay(); // 0 = Pazar
  return addDaysToKey(dayKey, -((dow + 6) % 7));
}

/** Gün çipi → fabrika günü aralığı (anahtar). `tumu` → sınırsız. */
export function dayRange(f: Pick<PrintHistoryFilterState, "gun" | "gunBas" | "gunBit">, now: Date = new Date()): { gunBas?: string; gunBit?: string } {
  const today = factoryDayKey(now);
  switch (f.gun) {
    case "bugun":
      return { gunBas: today, gunBit: today };
    case "dun": {
      const y = addDaysToKey(today, -1);
      return { gunBas: y, gunBit: y };
    }
    case "hafta":
      return { gunBas: weekStartKey(today), gunBit: today };
    case "aralik":
      return {
        ...(f.gunBas && DAY_RE.test(f.gunBas) ? { gunBas: f.gunBas } : {}),
        ...(f.gunBit && DAY_RE.test(f.gunBit) ? { gunBit: f.gunBit } : {}),
      };
    default:
      return {};
  }
}

/** Süzgeç → sorgu parametresi (liste ve özet AYNI parametreyi kullanır). */
export function toQueryParams(f: PrintHistoryFilterState, now: Date = new Date()): Record<string, string> {
  const p: Record<string, string> = { ...dayRange(f, now) } as Record<string, string>;
  if (f.userId) p.userId = f.userId;
  if (f.printer) {
    if (isUuid(f.printer)) p.peripheralDeviceId = f.printer;
    else p.printerName = f.printer;
  }
  if (f.deviceRefId) p.deviceRefId = f.deviceRefId;
  if (f.subjectKind) p.subjectKind = f.subjectKind;
  if (f.status) p.status = f.status;
  if (f.outputKind) p.outputKind = f.outputKind;
  if (f.source) p.source = f.source;
  if (f.subjectId) p.subjectId = f.subjectId;
  return p;
}

/**
 * URL → süzgeç. Derin bağlantı (kayıt detayı `?subjectId=`, bildirim `?printer=&status=`) gün
 * vermezse zaman sınırı konmaz — "bu topun bütün baskıları"; çıplak açılış "Bugün"dür.
 */
export function fromSearchParams(sp: URLSearchParams): PrintHistoryFilterState {
  const get = (k: string) => {
    const v = sp.get(k);
    return v && v.length > 0 ? v : undefined;
  };
  const deep = !!(get("subjectId") || get("printer") || get("status") || get("userId") || get("deviceRefId"));
  const rawGun = get("gun") as PrintDayChip | undefined;
  const gun: PrintDayChip = rawGun && CHIPS.includes(rawGun) ? rawGun : get("gunBas") || get("gunBit") ? "aralik" : deep ? "tumu" : "bugun";
  return {
    gun,
    gunBas: gun === "aralik" ? get("gunBas") : undefined,
    gunBit: gun === "aralik" ? get("gunBit") : undefined,
    userId: get("userId"),
    printer: get("printer"),
    deviceRefId: get("deviceRefId"),
    subjectKind: get("subjectKind") as PrintSubjectKind | undefined,
    status: get("status") as PrintStatus | undefined,
    outputKind: get("outputKind") as PrintOutputKind | undefined,
    source: get("source") as PrintSource | undefined,
    subjectId: get("subjectId"),
  };
}

/** Süzgeç → URL (paylaşılabilir; varsayılan "Bugün" yazılmaz). */
export function toSearchParams(f: PrintHistoryFilterState): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.gun !== "bugun") sp.set("gun", f.gun);
  if (f.gun === "aralik") {
    if (f.gunBas) sp.set("gunBas", f.gunBas);
    if (f.gunBit) sp.set("gunBit", f.gunBit);
  }
  const keys = ["userId", "printer", "deviceRefId", "subjectKind", "status", "outputKind", "source", "subjectId"] as const;
  for (const k of keys) {
    const v = f[k];
    if (v) sp.set(k, v);
  }
  return sp;
}

/** Özet şeridinin dönem öneki. */
export function dayChipLabel(f: Pick<PrintHistoryFilterState, "gun" | "gunBas" | "gunBit">): string {
  switch (f.gun) {
    case "bugun":
      return "Bugün";
    case "dun":
      return "Dün";
    case "hafta":
      return "Bu hafta";
    case "aralik":
      return "Seçili aralıkta";
    default:
      return "Toplam";
  }
}

/** Kayıt detayından gelen bağlantının hedefi (tek kaynak — `PrintHistoryLink`). */
export function printHistoryHref(subjectId: string): string {
  return `/system/print-history?subjectId=${encodeURIComponent(subjectId)}`;
}
