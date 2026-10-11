// Tezgah Salonu eylem listesi — sağ tık menüsü ve seçim çubuğu AYNI listeden çizilir (tek kaynak).
// Kural (tasarım §B + kullanıcı 2026-10-11): modül KAPALI → öğe hiç görünmez (kapalı modülün yüzeyi
// olmaz); izin YOK → öğe görünür ama pasif ve NEDENİNİ söyler. Son kararı her zaman sunucu verir.

export type FloorActionKey = "detail" | "stops" | "reports" | "selectAll" | "clear";

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
}

const NO_PERM = (what: string) => `Yetkiniz yok — ${what} izni gerekir.`;

function item(key: FloorActionKey, label: string, reason: string | null): FloorAction {
  return { key, label, enabled: reason === null, reason };
}

export function floorActionsOf(ctx: FloorActionCtx): FloorAction[] {
  const out: FloorAction[] = [];
  if (ctx.count === 1) out.push(item("detail", "Detayı aç", null));
  if (ctx.dokumaEnabled) {
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
