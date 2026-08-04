// =============================================================================
// Refakat Kartı — BÖLÜM kataloğu (stüdyonun sıraladığı birimler)
// =============================================================================
// Kartın gövdesi dokuz adlandırılmış bölümden oluşur. Stüdyo (SECTIONS modu)
// bunların SIRASINI ve AÇIK/KAPALI durumunu değiştirir; renderer bu listeyi
// okuyup gövdeyi kurar.
//
// NEDEN AKIŞ MODELİ, ETİKET STÜDYOSUNDAKİ GİBİ MUTLAK KANVAS DEĞİL: kartın üç
// tablosu (rota adımları, siparişler, partiler) SATIR SAYISI ÖNCEDEN BİLİNMEYEN
// listelerdir. Mutlak konumlu bir kutu büyüyemez — 2 adımlık kartta boşluk,
// 8 adımlıkta taşma verirdi. Etiket sabit ölçülü bir yüzeydir, kart ise akan bir
// belgedir; ikisi bilerek farklı modelde.
// =============================================================================

export const TRAVELER_SECTION_KEYS = [
  "header",
  "identity",
  "spec",
  "properties",
  "batches",
  "operations",
  "instructions",
  "orders",
  "footer",
] as const;

export type TravelerSectionKey = (typeof TRAVELER_SECTION_KEYS)[number];

export interface TravelerSection {
  key: TravelerSectionKey;
  enabled?: boolean;
}

/** Stüdyo etiketleri + ne olduğu (panelde bölüm listesinde gösterilir). */
export const TRAVELER_SECTION_LABELS: Record<TravelerSectionKey, { label: string; desc: string }> = {
  header: { label: "Antet", desc: "Firma adı, künye, KART NO ve basım bilgisi." },
  identity: { label: "Kimlik + Karekod", desc: "İş emri no, tür/rota, ürün ve okutulacak karekod." },
  spec: { label: "Özet Tablo", desc: "Renk / En / Hedef metraj / Kat tipi / tarihler." },
  properties: { label: "Özellikler", desc: "Hedef özellik rozetleri (Su İticilik, Zımparalı…)." },
  batches: { label: "Partiler", desc: "Parti no, top adedi, metraj ve açık fason sevki." },
  operations: { label: "Operasyon Kaydı", desc: "İstasyon satırları + elle doldurulan imza grid'i." },
  instructions: { label: "Talimatlar", desc: "Adım notları (boyahane talimatı vb.)." },
  orders: { label: "Bağlı Siparişler", desc: "Sipariş no, müşteri, ürün, renk, miktar." },
  footer: { label: "Alt Not", desc: "Kartın altına basılan serbest not." },
};

/**
 * Ham `sections` değerini güvenli listeye çözer.
 *
 * Üç güvence: (1) tanınmayan anahtar ATILIR (şema değişince eski config kartı
 * bozmasın), (2) listede olmayan bölüm SONA EKLENİR — yeni bir bölüm eklendiğinde
 * eski kayıtlı sıralar onu sessizce YUTMASIN diye, (3) `sections` hiç yoksa
 * varsayılan sıra döner (yerleşik kart).
 *
 * (2) olmasaydı: bugün kaydedilmiş bir sıra, yarın eklenen "Kalite Notu"
 * bölümünü hiç basmazdı ve kimse sebebini bulamazdı.
 */
export function resolveSectionOrder(raw: unknown): TravelerSection[] {
  const known = new Set<string>(TRAVELER_SECTION_KEYS);
  const out: TravelerSection[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const key = (item as { key?: unknown }).key;
      if (typeof key !== "string" || !known.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: key as TravelerSectionKey,
        enabled: (item as { enabled?: unknown }).enabled !== false,
      });
    }
  }
  for (const key of TRAVELER_SECTION_KEYS) {
    if (!seen.has(key)) out.push({ key, enabled: true });
  }
  return out;
}
