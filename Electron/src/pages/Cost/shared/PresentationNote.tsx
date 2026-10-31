// SY-J1 — maliyet sunum dövizi notu: kur ve kaynağı (kayıttaki donmuş kur / günün önizleme kuru) ya da
// eksik kur uyarısı. Sayıların hepsi sunucudan gelir; burada bölme YOK (kural: istemci hesap yapmaz).
import type { CostPresentationFields } from "./cost-types";
import { fmtDec, fmtDecFull } from "./format";

/** Döviz/m gösterimi; alan yoksa (ayar TRY) null döner ki çağıran hiçbir şey çizmesin. */
export function presentationAmount(p: CostPresentationFields, v: string | null | undefined): string | null {
  if (!p.sunumDovizi) return null;
  return v === null || v === undefined ? "—" : `${fmtDec(v, 4)} ${p.sunumDovizi}/m`;
}

export function PresentationNote({ p }: { p: CostPresentationFields }) {
  if (!p.sunumDovizi) return null;
  if (p.sunumUyarisi === "FX_MISSING" || !p.sunumKuru) {
    return (
      <p data-code="FX_MISSING" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
        ⚠ {p.sunumDovizi} kuru bulunamadı; {p.sunumDovizi} tutarı gösterilmez (kur 1 varsayılmaz). TL tutarlar geçerlidir.
      </p>
    );
  }
  const source = p.sunumKuruKaynagi === "SURUM" ? "kayıt günündeki kur (donmuş; kur değişse de aynı kalır)" : "önizleme kuru (günün kuru)";
  return (
    <p data-testid="presentation-rate" className="text-xs text-muted-foreground">
      1 {p.sunumDovizi} = {fmtDecFull(p.sunumKuru, 6)} TL · {source}
    </p>
  );
}
