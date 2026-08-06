// =============================================================================
// İPTAL KARARLARI — saf yardımcılar (DB/UI yok, birim testlenebilir)
// =============================================================================
import type { CancelDisposition, CancelImpactRoll } from "./service";

/** Üç seçenek. Kapatmanın altı aksiyonu BURADA YOK — iptal "üretildi" demez. */
export const CANCEL_OPTIONS: {
  value: CancelDisposition;
  label: string;
  hint: string;
}[] = [
  { value: "STOCK", label: "Ham stok", hint: "Kumaş geri döner" },
  { value: "SCRAP", label: "Fire", hint: "Mal vardı, çöpe gitti" },
  { value: "CANCELLED", label: "Hatalı kayıt", hint: "Mal hiç yoktu" },
];

/**
 * Hazır gerekçeler. Serbest yazım kaldırılmadı, "Diğer"in altına alındı: eldivenli
 * kullanıcı vardiya ortasında `"aaa"` / `"."` doldurmaları üretiyor ve o, boş
 * bırakmaktan DAHA KÖTÜdür (denetimde cevap varmış gibi görünür, hiçbir şey
 * söylemez). Kategori ayrıca veriyi sayılabilir yapar.
 * ⚠️ Sahada sürekli "Diğer" seçiliyorsa KATALOG yanlıştır — serbest metinlere bakıp
 * seçenekleri güncelle, listeyi büyütme.
 */
export const CANCEL_REASON_PRESETS = [
  "Sipariş iptal oldu",
  "Yanlış iş emri açıldı",
  "Müşteri vazgeçti",
  "Mükerrer kayıt",
] as const;

export const MIN_REASON_LENGTH = 3;

/** Karar haritası: rollId → aksiyon. Haritada olmayan top varsayılan STOCK'tur. */
export type CancelChoices = Record<string, CancelDisposition>;

/**
 * Uca gidecek karar listesi.
 *
 * ⚠️ `STOCK` satırları GÖNDERİLMEZ. Backend onları zaten toplu yolda uyguluyor ve
 * motora verilseydi aynı karar, istemci satırı gönderdi mi göndermedi mi diye iki
 * farklı hareket satırı üretirdi. Bu filtre backend'deki ikizinin aynasıdır —
 * ikisinden biri kalkarsa fark sessizce geri döner.
 */
export function buildCancelDispositions(
  rolls: CancelImpactRoll[],
  choices: CancelChoices,
): { rollId: string; action: CancelDisposition }[] {
  return rolls
    .filter((r) => r.decidable)
    .map((r) => ({ rollId: r.id, action: choices[r.id] ?? ("STOCK" as CancelDisposition) }))
    .filter((d) => d.action !== "STOCK");
}

/** Footer'daki tek satırlık özet için sayım. */
export function summarizeChoices(
  rolls: CancelImpactRoll[],
  choices: CancelChoices,
): { stock: number; scrap: number; cancelled: number } {
  let stock = 0;
  let scrap = 0;
  let cancelled = 0;
  for (const r of rolls) {
    if (!r.decidable) continue;
    const action = choices[r.id] ?? "STOCK";
    if (action === "SCRAP") scrap += 1;
    else if (action === "CANCELLED") cancelled += 1;
    else stock += 1;
  }
  return { stock, scrap, cancelled };
}

/** "9 ham stok · 2 fire · 1 hatalı kayıt" — sıfırlar basılmaz. */
export function formatSummary(s: {
  stock: number;
  scrap: number;
  cancelled: number;
}): string {
  return (
    [
      s.stock > 0 ? `${s.stock} ham stok` : null,
      s.scrap > 0 ? `${s.scrap} fire` : null,
      s.cancelled > 0 ? `${s.cancelled} hatalı kayıt` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "karar bekleyen top yok"
  );
}

/** Fason dönüşü topa "Ham stok" seçtirilemez (backend de reddeder). */
export function isOptionDisabled(roll: CancelImpactRoll, option: CancelDisposition): boolean {
  return option === "STOCK" && !roll.canReturnToStock;
}

/**
 * Toplu uygulama: yalnız karar verilebilir VE o seçeneğe uygun toplara yazar.
 * Uygun olmayanı sessizce atlar — yoksa "hepsine ham stok" tıklaması, backend'in
 * reddedeceği bir liste kurar ve kullanıcı sebebini ancak gönderince öğrenir.
 */
export function applyBulkChoice(
  rolls: CancelImpactRoll[],
  action: CancelDisposition,
  prev: CancelChoices,
): CancelChoices {
  const next: CancelChoices = { ...prev };
  for (const r of rolls) {
    if (!r.decidable) continue;
    if (isOptionDisabled(r, action)) continue;
    next[r.id] = action;
  }
  return next;
}

/** İstasyona göre grupla — düz liste 50 topta okunmaz hale geliyor. */
export function groupByStation<T extends { stationName?: string | null }>(
  rolls: T[],
): { stationName: string; rolls: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rolls) {
    const key = r.stationName ?? "—";
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return [...map.entries()].map(([stationName, list]) => ({ stationName, rolls: list }));
}
