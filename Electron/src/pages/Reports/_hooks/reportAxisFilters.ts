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
export type AxisKey = "customerId" | "itemId" | "colorId" | "subcontractorId" | "reasonCode" | "cariId";
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

/**
 * "Süzgeç kesti" cümlesi: boş tablo ile süzülmüş tablo aynı şey değildir.
 * ⚠️ Alan OPSİYONELDİR ve yokluğu "kesilmedi" DEĞİL "bilinmiyor"dur: anahtar
 * yoksa satır hiç yazılmaz. Dokuma (R5b-b) baştan taşıyordu; satış/müşteri/fason
 * ailesine 6e `c52c2bc4` ile geldi (aynı yayın).
 */
export function droppedNote(dusenSatir: number | undefined): string | null {
  return dusenSatir && dusenSatir > 0 ? `Süzgeç ${dusenSatir} satırı kapsam dışında bıraktı.` : null;
}

// -----------------------------------------------------------------------------
// EKSEN SÖZLÜĞÜ — etiket · boş ipucu · ŞERH tek yerde
// -----------------------------------------------------------------------------
// Aynı eksen sekiz raporda çıkar; etiketi ve şerhi her sayfada yeniden yazmak
// "aynı süzgeç, iki farklı cümle" demektir — ve şerh EKSENİN kendisine aittir,
// onu gösteren ekrana değil.
export const AXIS_LABELS: Record<AxisKey, string> = {
  cariId: "Cari",
  customerId: "Müşteri",
  itemId: "Kumaş",
  colorId: "Renk",
  subcontractorId: "Fasoncu",
  reasonCode: "İptal sebebi",
};

export const AXIS_EMPTY_HINTS: Record<AxisKey, string> = {
  cariId: "Pencerede cari yok",
  customerId: "Pencerede müşteri yok",
  itemId: "Pencerede kumaş yok",
  colorId: "Pencerede renk yok",
  subcontractorId: "Pencerede fasoncu yok",
  reasonCode: "Pencerede sebep yok",
};

/** Eksenin KENDİ niteleyicisi — ekranda da çıktıda da aynı cümle. */
export const AXIS_CAVEATS: Partial<Record<AxisKey, string>> = {
  reasonCode: "Yalnız PAYI süzer: payda (dönemde açılan siparişler) süzülmez ⇒ oran 'bu sebeple iptal ÷ açılan'.",
};

export const DESTINATION_LABEL = "Sevk hedefi";
export const DESTINATION_CAVEAT = "Müşteri kartındaki VARSAYILAN hedef — sevkin fiili hedefi değil.";

interface AxisNoteInput {
  eksenler: readonly AxisKey[];
  destination?: boolean;
  secenekler: Partial<Record<AxisKey, Array<{ id?: string; code?: string; ad: string }>>> | undefined;
  sel: Record<AxisKey, string[]> & { destination: Destination | "" };
  dusenSatir?: number;
  /** Rapora özgü ek şerh — yalnız SÜZGEÇ AÇIKKEN anlamlı olanlar (örn. ABC evreni). */
  ek?: string[];
  /**
   * Sunucunun süzgeç YANKISI (`suzgec`). Seçili bir eksen yankıda yoksa süzgeç sunucuya ULAŞMAMIŞ demektir
   * ve şerh bunu söyler — "SÜZGEÇ — Müşteri: X" yazıp herkesin toplamını göstermek sessiz bir yalandır
   * (yaşandı: istemci allowlist'i eksenleri düşürüyordu, d9 L4 2026-09-18). `undefined` = yankı hiç yok.
   */
  uygulanan?: object | null;
}

/** Sunucunun uygulamadığı seçili eksenler — yankı yoksa hepsi, varsa yankıda olmayanlar. */
export function unappliedAxes(sel: Record<string, string[] | string>, eksenler: readonly string[], uygulanan: object | null | undefined): string[] {
  const secili = eksenler.filter((a) => { const v = sel[a]; return Array.isArray(v) ? v.length > 0 : Boolean(v); });
  return secili.filter((a) => !uygulanan || !(a in uygulanan));
}

export const unappliedNote = (labels: string[]): string => `⚠️ Sunucu şu süzgeci UYGULAMADI: ${labels.join(" · ")} — rakamlar süzülmemiş olabilir; sayfayı yenileyin, sürerse bildirin.`;

/** Sayfanın süzgeç satırları: ekrana basılan liste ile çıktı meta'sı AYNI dizidir. */
export function axisNotes({ eksenler, destination, secenekler, sel, dusenSatir, ek = [], uygulanan }: AxisNoteInput): string[] {
  const parts = eksenler.map((a) => ({
    eksen: AXIS_LABELS[a],
    degerler: labelsOf(secenekler?.[a], sel[a]),
    serh: AXIS_CAVEATS[a],
  }));
  if (destination) {
    parts.push({
      eksen: DESTINATION_LABEL,
      degerler: sel.destination ? [sel.destination === "EXPORT" ? "İhracat" : "Yurtiçi"] : [],
      serh: DESTINATION_CAVEAT,
    });
  }
  const notes = filterNotes(parts);
  // Ek şerh ve "kesti" cümlesi yalnız süzgeç AÇIKKEN yazılır: süzgeçsiz raporun
  // çıktısı bayt bayt eski kalmalı.
  if (notes.length === 0) return notes;
  const dropped = droppedNote(dusenSatir);
  // Yankı YALNIZ verildiyse ölçülür (`uygulanan` anahtarı hiç geçilmediyse eski davranış): seçili eksen
  // yankıda yoksa uyarı — süzgeç sunucuya ulaşmadı ya da uç o ekseni tanımıyor.
  // `undefined` = yankı ÖLÇÜLMEDİ (eski çağıran / veri henüz yok) → eski çıktı; `null` = cevap geldi ama yankı YOK → hepsi uygulanmamış.
  const eksik = uygulanan === undefined ? [] : unappliedAxes(sel, [...eksenler, ...(destination ? ["destination"] : [])], uygulanan);
  const uyari = eksik.length > 0 ? [unappliedNote(eksik.map((a) => (a === "destination" ? DESTINATION_LABEL : AXIS_LABELS[a as AxisKey])))] : [];
  return [...notes, ...ek, ...(dropped ? [dropped] : []), ...uyari];
}

// -----------------------------------------------------------------------------
// LEVENT / LOT ŞERHLERİ (R5b-b2) — sunucunun YANKISI ekrana ve kâğıda geçer
// -----------------------------------------------------------------------------
/** Sunucunun süzgeç beyanı: verilen anahtarlar + kaç levent eşleşti, kaç satır düştü. */
export interface BeamSuzgec {
  warpBeamId?: string;
  lotNo?: string;
  levent: number;
  dusenSatir: number;
}

/**
 * Levent/lot süzgecinin satırları. İki şey EKRANDA da KÂĞITTA da yazılı olmalı:
 * ① lot ekseni LEVENT üzerinden süzer (lotla sarılmış leventlerin satırları) —
 * "bu lotun topları" değil ② eşleşen levent SIFIRSA rapor boştur ve bu bir HATA
 * DEĞİL sonuçtur (bilinmeyen levent/lot 404 dönmez, boş döner).
 */
export function beamLotNotes(opts: { beamLabel?: string | null; lotNo?: string; suzgec?: BeamSuzgec }): string[] {
  const { beamLabel, lotNo, suzgec } = opts;
  const notes = filterNotes([
    { eksen: "Levent", degerler: beamLabel ? [beamLabel] : [] },
    {
      eksen: "İplik lotu",
      degerler: lotNo ? [lotNo] : [],
      serh: "Lot ekseni LEVENT üzerinden süzer: bu lotla sarılmış leventlerin satırları.",
    },
  ]);
  if (notes.length === 0) return notes;
  if (suzgec) {
    notes.push(
      suzgec.levent === 0
        ? "Eşleşen levent YOK — tablo bu yüzden boş; bu bir hata değil, süzgecin sonucudur."
        : `Süzgeç ${suzgec.levent} leventle eşleşti.`,
    );
    const dropped = droppedNote(suzgec.dusenSatir);
    if (dropped) notes.push(dropped);
  }
  return notes;
}
