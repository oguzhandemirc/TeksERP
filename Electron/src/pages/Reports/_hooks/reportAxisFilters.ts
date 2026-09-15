// =============================================================================
// RAPOR EKSEN SÜZGEÇLERİ — SAF YARI (URL ↔ istek parametresi)
// =============================================================================
// Liste eksenleri URL'de CSV olarak yaşar (`?customerId=a,b`): bağlantı
// paylaşılabilir, yenilemede kaybolmaz, geri tuşu çalışır. Boş = "Tümü" ve
// istekte anahtar HİÇ GİTMEZ — bugünkü davranış budur, `""` göndermek sunucuya
// "boş liste" demek olurdu.
//
// ⚠️ CSV DE BİR STRING'DİR: sunucu tarafında `readIdCondition`/`readFilterList`
// kalıbının istemci ikizi. Ayrıştırma tek yerde yaşar ki "a, b" (boşluklu) ile
// "a,b" iki farklı süzgeç sanılmasın.
// =============================================================================
export type AxisKey = "customerId" | "itemId" | "colorId" | "subcontractorId" | "reasonCode";
export type Destination = "DOMESTIC" | "EXPORT";

/** URL değeri → id listesi. Boş/whitespace düşer, sıra korunur, tekrar elenir. */
export function parseCsv(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** id listesi → URL değeri. Boş liste `null` döner: anahtar URL'den SİLİNİR. */
export function toCsv(ids: readonly string[]): string | null {
  const v = ids.map((x) => x.trim()).filter(Boolean);
  return v.length ? v.join(",") : null;
}

/**
 * Seçili eksenlerden istek parametresi. Boş eksen anahtarı HİÇ eklenmez —
 * "Tümü" seçiliyken istek bayt bayt eski hâlidir (bugünkü davranış).
 */
export function axisParams(
  sel: Partial<Record<AxisKey, string[]>> & { destination?: Destination | "" },
): Record<string, string> {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(sel)) {
    if (k === "destination") continue;
    const csv = toCsv((v as string[]) ?? []);
    if (csv) p[k] = csv;
  }
  if (sel.destination) p.destination = sel.destination;
  return p;
}

/** Seçili id'lerin görünen adları — çıktı başlığındaki süzgeç satırı için. */
export function labelsOf(options: Array<{ id?: string; code?: string; ad: string }> | undefined, ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const byKey = new Map((options ?? []).map((o) => [o.id ?? o.code ?? "", o.ad]));
  return ids.map((id) => byKey.get(id) ?? id);
}

/**
 * Süzgeç satırı (K10) — ÇIKTIYA da girer. Niteleyiciler burada yaşar:
 * `destination` müşterinin VARSAYILAN hedefidir (sevkin fiili hedefi değil) ve
 * `reasonCode` iptal karnesinde yalnız PAYI süzer. İkisi de ekranda yazılı; aynı
 * cümle dosyaya geçmezse, tek başına paylaşılan dosyada uyarı YOK demektir.
 */
export function filterNotes(parts: Array<{ eksen: string; degerler: string[]; serh?: string }>): string[] {
  return parts
    .filter((p) => p.degerler.length > 0)
    .map((p) => `SÜZGEÇ — ${p.eksen}: ${p.degerler.join(" · ")}.${p.serh ? ` ${p.serh}` : ""}`);
}

/** "Süzgeç kesti" cümlesi: boş tablo ile süzülmüş tablo aynı şey değildir. */
export function droppedNote(dusenSatir: number | undefined): string | null {
  return dusenSatir && dusenSatir > 0 ? `Süzgeç ${dusenSatir} satırı kapsam dışında bıraktı.` : null;
}
