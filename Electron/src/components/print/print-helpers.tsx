import type { CompanyLetterhead, ResolvedDocConfig } from "@/services/documentConfig";

// =============================================================================
// Yazdırılabilir belge ortak parçaları — irsaliye/çeki bileşenleri paylaşır.
// `.print-area` içinde kullanılır (global @media print CSS yalnız onu basar).
// =============================================================================

/**
 * Önizleme override'ı — belge "sheet" bileşenlerine geçilir. Verilmezse bileşen
 * canlı ayarı (useFeatureFlags) okur; verilirse (Belge Şablonları önizlemesi)
 * taslak ayarı + örnek künyeyi kullanır.
 */
export interface DocSheetPreview {
  cfg: ResolvedDocConfig;
  companyName: string;
  letterhead: CompanyLetterhead;
}

/** Belge üst künyesi — firma adı + (varsa) adres/telefon/vergi satırı. */
export function PrintLetterhead({
  companyName,
  letterhead,
}: {
  companyName: string;
  letterhead: CompanyLetterhead;
}) {
  const lines = [letterhead.addressLine, letterhead.phone, letterhead.taxInfo]
    .map((x) => x?.trim())
    .filter((x): x is string => Boolean(x));
  return (
    <div className="mb-2 border-b border-gray-300 pb-2 text-center">
      <div className="text-[15px] font-bold uppercase tracking-wide">{companyName}</div>
      {lines.length > 0 && (
        <div className="mt-0.5 text-[10px] text-gray-700">{lines.join("  ·  ")}</div>
      )}
    </div>
  );
}

/** Belge altı imza kutuları — etiket sayısına göre eşit sütun. */
export function SignatureBoxes({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div
      className="mt-10 grid gap-6 text-[11px]"
      style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}
    >
      {labels.map((label, i) => (
        <div key={i}>
          <div className="text-gray-600">{label}</div>
          <div className="mt-8 border-b border-black" />
          <div className="mt-1 text-center text-[10px] text-gray-600">Ad-Soyad / İmza</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Belge filigranı — TASLAK (henüz resmi değil) / İPTAL (kaynak iptal edildi).
 * `.print-area` içine, relative bir kapsayıcının çocuğu olarak konur; çapraz,
 * yarı saydam, baskıda da görünür. `tone` rengi belirler.
 */
export function DocWatermark({
  text,
  tone = "draft",
}: {
  text: string;
  tone?: "draft" | "void" | "superseded";
}) {
  const color =
    tone === "void"
      ? "rgba(220,38,38,0.16)"
      : tone === "superseded"
        ? "rgba(217,119,6,0.18)" // Y4: revize edilmis eski versiyon — amber
        : "rgba(120,120,120,0.14)";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as React.CSSProperties}
    >
      <span
        className="select-none whitespace-nowrap font-bold uppercase tracking-widest"
        style={{ transform: "rotate(-32deg)", fontSize: "84px", color }}
      >
        {text}
      </span>
    </div>
  );
}

/** Belge altı serbest not (boş → basılmaz). */
export function DocFooterNote({ note }: { note: string }) {
  if (!note.trim()) return null;
  return (
    <div className="mt-4 whitespace-pre-wrap rounded border border-gray-300 px-3 py-2 text-[11px]">
      {note}
    </div>
  );
}
