// =============================================================================
// TOPLU ÇUVAL İZİ — SAF KARAR KATMANI (2026-09-04)
// =============================================================================
// Popover'ın ÜÇ DURUMLU kutucuk mantığı, gövde kurucusu ve kısmi sonuç özeti
// burada; bileşen yalnız çizer. Ayrı dosya olmasının sebebi bekçidir: bu üç
// kural (üç durum · `skipped` yutulmaması · sentinel) React ağacı kurulmadan
// ölçülebilmeli (`SackEntryGate` emsali).
// =============================================================================

import type { SackSearchRow } from "./types";

/**
 * Bir etiketin seçili çuvallardaki durumu.
 *
 * ⚠️ ÜÇ DURUM LOAD-BEARING: iki durumlu (işaretli/işaretsiz) bir kutucukta
 * operatör "hepsinden KALDIRDIM" ile "hiç DOKUNMADIM"ı ayırt edemez — karışık
 * seçimde kutucuk boş görünür, dokunulmadan kaydedilirse ya izler sessizce
 * silinir ya hiçbir şey olmaz. "some" bunu görünür kılar.
 */
export type TagTriState = "all" | "some" | "none";

/** Kullanıcının bir etiket üzerinde ALDIĞI karar (kutucuğa dokununca değişir). */
export type TagIntent = "add" | "remove" | "keep";

export function tagTriState(rows: SackSearchRow[], tagId: string): TagTriState {
  if (rows.length === 0) return "none";
  let hit = 0;
  for (const r of rows) if (r.tags.some((t) => t.id === tagId)) hit++;
  if (hit === 0) return "none";
  return hit === rows.length ? "all" : "some";
}

/**
 * Kutucuğa dokunulunca sıradaki NİYET.
 *
 * Döngü, satırın MEVCUT durumundan başlar ve "dokunmadım"a (`keep`) geri
 * dönebilir — geri dönüş şart: yanlışlıkla dokunan operatörün popover'ı kapatıp
 * yeniden açmadan kararı geri alması gerekir.
 *
 *  hepsinde  →  kaldır → (dokunma)
 *  bazısında →  ekle   → kaldır → (dokunma)
 *  hiçbirinde→  ekle   → (dokunma)
 */
export function nextIntent(state: TagTriState, current: TagIntent): TagIntent {
  if (state === "all") return current === "keep" ? "remove" : "keep";
  if (state === "none") return current === "keep" ? "add" : "keep";
  // "some": önce hepsine ekle, sonra hepsinden kaldır, sonra dokunma.
  if (current === "keep") return "add";
  if (current === "add") return "remove";
  return "keep";
}

/** Kutucuğun ÇİZİLECEK hâli — niyet varsa niyeti gösterir, yoksa mevcut durumu. */
export function checkboxView(
  state: TagTriState,
  intent: TagIntent,
): { checked: boolean; indeterminate: boolean; changed: boolean } {
  if (intent === "add") return { checked: true, indeterminate: false, changed: true };
  if (intent === "remove") return { checked: false, indeterminate: false, changed: true };
  return { checked: state === "all", indeterminate: state === "some", changed: false };
}

export interface BulkTagPayload {
  sackIds: string[];
  add?: string[];
  remove?: string[];
  removeAll?: boolean;
}

/**
 * Gövde kurucusu.
 *
 * ⚠️ `removeAll` ile `remove` BİRLİKTE GÖNDERİLEMEZ — sunucu 400 verir
 * (niyeti sessizce seçmez). Bu yüzden `removeAll` seçildiğinde tek tek
 * kaldırmalar DÜŞÜRÜLÜR; `add` ile birlikte gitmesi serbesttir (önce her şeyi
 * temizle, sonra seçilenleri bırak = yeniden etiketleme tek hamle).
 *
 * ⚠️ Hiçbir niyet yoksa `null` döner — boş gövde göndermek sunucudan
 * "Uygulanacak etiket seçilmedi" 400'ü alırdı; kullanıcıya bunu HATA olarak
 * göstermek yanlış, çünkü hiçbir şey yapmamıştır.
 */
export function buildBulkPayload(
  sackIds: string[],
  intents: Record<string, TagIntent>,
  removeAll: boolean,
): BulkTagPayload | null {
  if (sackIds.length === 0) return null;
  const add = Object.entries(intents)
    .filter(([, v]) => v === "add")
    .map(([k]) => k);
  const remove = removeAll
    ? []
    : Object.entries(intents)
        .filter(([, v]) => v === "remove")
        .map(([k]) => k);
  if (!removeAll && add.length === 0 && remove.length === 0) return null;
  return {
    sackIds,
    ...(add.length ? { add } : {}),
    ...(remove.length ? { remove } : {}),
    ...(removeAll ? { removeAll: true } : {}),
  };
}

export interface BulkTagResult {
  added: number;
  removed: number;
  skipped: { sackId: string; reason: string }[];
}

/**
 * SONUÇ ÖZETİ — uç PARÇALI sonuç döner (sevk edilmiş çuval atlanır, 409
 * ATILMAZ).
 *
 * ⚠️ `skipped` SESSİZCE YUTULAMAZ: operatör 12 çuval seçip 3'ünün atlandığını
 * bilmezse "bıraktım" sanır ve iz o üç çuvalda yoktur. Bu yüzden özet
 * `tone:"warning"` döner ve atlanan satırların gerekçesi metne girer.
 */
export function summarizeBulkResult(res: BulkTagResult): {
  tone: "success" | "warning";
  title: string;
  description?: string;
} {
  const parts: string[] = [];
  if (res.added) parts.push(`${res.added} iz bırakıldı`);
  if (res.removed) parts.push(`${res.removed} iz kaldırıldı`);
  const title = parts.length ? parts.join(", ") : "Değişiklik yok";
  if (res.skipped.length === 0) return { tone: "success", title };
  const shown = res.skipped.slice(0, 3).map((s) => s.reason);
  const rest = res.skipped.length - shown.length;
  return {
    tone: "warning",
    title,
    description:
      `${res.skipped.length} çuval atlandı: ` + shown.join(" · ") + (rest > 0 ? ` · +${rest} çuval` : ""),
  };
}
