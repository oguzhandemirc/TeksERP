// Tezgah Salonu eylem listesi — sağ tık menüsü ve seçim çubuğu AYNI listeden çizilir (tek kaynak).
// Kural (tasarım §B + kullanıcı 2026-10-11): modül KAPALI → öğe hiç görünmez (kapalı modülün yüzeyi
// olmaz); izin YOK → öğe görünür ama pasif ve NEDENİNİ söyler. Son kararı her zaman sunucu verir.

export type FloorActionKey = "detail" | "assign" | "replace" | "finish" | "revoke" | "stops" | "reports" | "selectAll" | "clear";

/** Koşum (iş) eylemleri — `/api/machine-runs` yalnız bunlardan açılır; YALNIZ `dokumaEnabled` dalında doğarlar (bekçi §7f). */
export const RUN_ACTION_KEYS = ["assign", "replace", "finish", "revoke"] as const satisfies readonly FloorActionKey[];
export type RunActionKey = (typeof RUN_ACTION_KEYS)[number];

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
