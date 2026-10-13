// Tezgah Salonu eylem listesi — sağ tık menüsü ve seçim çubuğu AYNI listeden çizilir (tek kaynak).
// Kural (tasarım §B + kullanıcı 2026-10-11): modül KAPALI → öğe hiç görünmez (kapalı modülün yüzeyi
// olmaz); izin YOK → öğe görünür ama pasif ve NEDENİNİ söyler. Son kararı her zaman sunucu verir.

export type FloorActionKey =
  | "detail"
  | "assign"
  | "replace"
  | "finish"
  | "revoke"
  | "stopOpen"
  | "stopClose"
  | "stopClassify"
  | "stopRevoke"
  | "stops"
  | "reports"
  | "selectAll"
  | "clear";

/** Koşum (iş) eylemleri — `/api/machine-runs` yalnız bunlardan açılır; YALNIZ `dokumaEnabled` dalında doğarlar (bekçi §7f). */
export const RUN_ACTION_KEYS = ["assign", "replace", "finish", "revoke"] as const satisfies readonly FloorActionKey[];
export type RunActionKey = (typeof RUN_ACTION_KEYS)[number];

/** Toplu duruş eylemleri — `/api/machine-stops/bulk/*` yalnız bunlardan açılır; YALNIZ `dokumaEnabled` dalında doğarlar (bekçi §7f). */
export const STOP_ACTION_KEYS = ["stopOpen", "stopClose", "stopClassify", "stopRevoke"] as const satisfies readonly FloorActionKey[];
export type StopActionKey = (typeof STOP_ACTION_KEYS)[number];

export interface FloorAction {
  key: FloorActionKey;
  label: string;
  enabled: boolean;
  /** Pasifse neden (Türkçe, kullanıcıya gösterilir). */
  reason: string | null;
}

export interface FloorActionCtx {
  /** Seçili tezgah sayısı. */
  count: number;
  dokumaEnabled: boolean;
  can: (perm: string) => boolean;
  /** Koşum eylemlerinin durumu; yoksa (örnek veri, TV) koşum eylemleri hiç çizilmez. */
  runs?: {
    /** Sunucuya ulaşılıyor mu — değilse yazma eylemleri pasif (C.15). */
    online: boolean;
    /** Seçimde açık koşumu olan tezgah sayısı; `null` = bilgi yok (eski sunucu → dört eylem pasif). */
    openRunLooms: number | null;
  };
  /** Toplu duruş eylemlerinin durumu; yoksa (örnek veri, TV) duruş eylemleri hiç çizilmez. */
  stops?: {
    online: boolean;
    /** Sunucu toplu duruş uçlarını tanıyor mu (salon ucunun `bulkStopActions` alanı); değilse eski sunucu → pasif. */
    bulk: boolean;
    /** Seçimde açık duruşu olan tezgah sayısı. */
    openStopLooms: number;
    /** Sunucu "Sebep ata" uçlarını tanıyor mu (salon ucunun `bulkClassifyAction` alanı); değilse eski sunucu → pasif. */
    bulkClassify?: boolean;
    /** Seçimde sebebi girilmemiş açık duruşu olan tezgah sayısı. */
    unclassifiedStopLooms?: number;
  };
}

const OFFLINE = "Sunucuya ulaşılamıyor — bağlantı gelince açılır.";
const OLD_SERVER = "Sunucu bu eylemi tanımıyor — sunucu güncellenince açılır.";

/** Koşum eylemi pasif mi — sıra: izin → bağlantı → tezgah durumu. */
function runReason(ctx: FloorActionCtx, perm: string, what: string, needsOpenRun: boolean): string | null {
  if (!ctx.can(perm)) return NO_PERM(what);
  if (!ctx.runs?.online) return OFFLINE;
  // Dokuma açıkken koşum bilgisi gelmiyorsa sunucu eskidir: toplu uçlar da yoktur.
  if (ctx.runs.openRunLooms === null) return OLD_SERVER;
  if (!needsOpenRun) return null;
  return ctx.runs.openRunLooms > 0 ? null : "Seçili tezgahta açık koşum yok.";
}

const NO_PERM = (what: string) => `Yetkiniz yok — ${what} izni gerekir.`;

/** Duruş eylemi pasif mi — sıra: izin → bağlantı → sunucu sürümü → seçimde açık duruş. */
function stopReason(ctx: FloorActionCtx, needsOpenStop: boolean): string | null {
  if (!ctx.can("loom:manual-entry")) return NO_PERM("Tezgah Duruşları");
  if (!ctx.stops?.online) return OFFLINE;
  if (!ctx.stops.bulk) return OLD_SERVER;
  if (!needsOpenStop) return null;
  return ctx.stops.openStopLooms > 0 ? null : "Seçili tezgahta açık duruş yok.";
}

/** "Sebep ata" pasif mi — sıra: izin (`loom:classify`) → bağlantı → sunucu sürümü → seçimde sebepsiz açık duruş. */
function classifyReason(ctx: FloorActionCtx): string | null {
  if (!ctx.can("loom:classify")) return NO_PERM("Duruş sınıflandırma");
  if (!ctx.stops?.online) return OFFLINE;
  if (!ctx.stops.bulkClassify) return OLD_SERVER;
  return (ctx.stops.unclassifiedStopLooms ?? 0) > 0 ? null : "Seçili tezgahta sebebi girilmemiş açık duruş yok.";
}

function item(key: FloorActionKey, label: string, reason: string | null): FloorAction {
  return { key, label, enabled: reason === null, reason };
}

export function floorActionsOf(ctx: FloorActionCtx): FloorAction[] {
  const out: FloorAction[] = [];
  if (ctx.count === 1) out.push(item("detail", "Detayı aç", null));
  if (ctx.dokumaEnabled) {
    if (ctx.runs && ctx.count > 0) {
      out.push(item("assign", "İş ver…", runReason(ctx, "loom:run", "Tezgah koşumu", false)));
      out.push(item("replace", "İşi değiştir…", runReason(ctx, "loom:run", "Tezgah koşumu", true)));
      out.push(item("finish", "İşi bitir…", runReason(ctx, "loom:run", "Tezgah koşumu", true)));
      if (ctx.count === 1) out.push(item("revoke", "Koşumu geri al…", runReason(ctx, "loom:run-revoke", "Koşum geri alma", true)));
    }
    if (ctx.stops && ctx.count > 0) {
      out.push(item("stopOpen", "Duruş bildir…", stopReason(ctx, false)));
      out.push(item("stopClose", "Hepsi çalıştı…", stopReason(ctx, true)));
      out.push(item("stopClassify", "Sebep ata…", classifyReason(ctx)));
      out.push(item("stopRevoke", "Duruşu geri al…", stopReason(ctx, true)));
    }
    const stopsOk = ctx.can("loom:manual-entry") || ctx.can("loom:classify");
    if (ctx.count === 1) out.push(item("stops", "Duruş listesi", stopsOk ? null : NO_PERM("Tezgah Duruşları")));
    out.push(item("reports", "Dokuma raporları", ctx.can("report:production") ? null : NO_PERM("Üretim raporları")));
  }
  out.push(item("selectAll", "Görünen tümünü seç", null));
  if (ctx.count > 0) out.push(item("clear", "Seçimi bırak", null));
  return out;
}

/** Duruş listesine derin bağlantı (tek tezgah süzgeciyle). */
export function stopsLinkOf(machineId: string): string {
  return `/operations/machine-stops?${new URLSearchParams({ "filter[machineId]": machineId }).toString()}`;
}

export const REPORTS_LINK = "/reports/dokuma";
