import { FileStack, Layers, MessageSquareText, Tag } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

/** Belgedeki üç veri listesi — backend `DISPATCH_LIST_SECTIONS` ile aynı sıra/anahtar. */
export const DISPATCH_LISTS = [
  { key: "urun", label: "Ürün Listesi", hint: "Stok adı · top adedi · toplam metre" },
  { key: "cuval", label: "Çuval Listesi", hint: "Çuval no · metre · kg · top adedi" },
  { key: "ceki", label: "Çeki Listesi", hint: "Top bazında barkod · desen · metre · kg" },
] as const;

export type DispatchListKey = (typeof DISPATCH_LISTS)[number]["key"];

export interface DispatchPrintOpts {
  /** Basılacak listeler. Üçü birden seçiliyse "varsayılan" demektir. */
  sections: DispatchListKey[];
  /** true → listeler aynı sayfada akar. Varsayılan false (her liste yeni sayfa). */
  merge: boolean;
  /** Çuval yorumlarını bu baskıda göster (kalıcı kolon ayarını ezer). */
  rowNotes: boolean;
  /**
   * Çuval İZLERİNİ (etiket) bu baskıda göster. ⚠️ `rowNotes`e BİNDİRİLMEZ —
   * iz ile yorum farklı hassasiyette veridir; tek anahtar "notu bas" diyene
   * sessizce izleri de bastırırdı (ve tersi).
   */
  rowTags: boolean;
}

export const DEFAULT_DISPATCH_PRINT_OPTS: DispatchPrintOpts = {
  sections: ["urun", "cuval", "ceki"],
  merge: false,
  rowNotes: false,
  rowTags: false,
};

interface Props {
  value: DispatchPrintOpts;
  onChange: (next: DispatchPrintOpts) => void;
  /** Çuval yorumu tikini gizle (çuval listesi basılmıyorsa anlamsız). */
  showRowNotes?: boolean;
  /** Çuval izi tikini gizle (çuval listesi basılmıyorsa anlamsız). */
  showRowTags?: boolean;
}

/**
 * Sevk irsaliyesi baskı seçenekleri — GÖVDE (kendi popover'ı YOK).
 *
 * Belge diyaloğunun tek "Baskı seçenekleri ▾" popover'ına slot olarak girer;
 * kendi tetikleyicisini taşısaydı popover içinde popover açardı ve seçenekler
 * yine iki ayrı yerde dururdu.
 *
 * Hepsi TEK SEFERLİKTİR: hiçbiri Belge Kişiselleştirme ayarına ya da donmuş
 * snapshot'a yazılmaz, yeni belge versiyonu doğurmaz. Diyalog kapanınca sıfırlanır.
 * Bilinçli tercih — kalıcı ayar donmuş belgeye yazılsaydı eski irsaliyeler yeni
 * seçeneği hiç göremezdi (snapshot `docConfigOverride`'ı freeze anında dondurur).
 */
export function DispatchPrintOptionsContent({
  value,
  onChange,
  showRowNotes = true,
  showRowTags = true,
}: Props) {
  const toggleSection = (key: DispatchListKey, on: boolean) => {
    const next = on
      ? DISPATCH_LISTS.filter((l) => l.key === key || value.sections.includes(l.key)).map((l) => l.key)
      : value.sections.filter((k) => k !== key);
    // Son tik kapatılamaz: gövdesiz belge basmanın anlamı yok ve backend de bu
    // durumda tek-seferlik seçimi yok sayıp kalıcı ayara düşer → kullanıcı
    // "kapattım ama yine çıktı" derdi. Kararı burada, görünür yerde tutuyoruz.
    if (next.length === 0) return;
    onChange({ ...value, sections: next as DispatchListKey[] });
  };

  const only = (key: DispatchListKey) => onChange({ ...value, sections: [key] });

  return (
    <>
      <div className="border-t pt-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 font-medium">
          <FileStack className="h-3.5 w-3.5" /> Basılacak listeler
        </div>
        <div className="space-y-1.5">
          {DISPATCH_LISTS.map((l) => (
            <div key={l.key} className="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-muted/60">
              <Checkbox
                id={`sec-${l.key}`}
                className="mt-0.5"
                checked={value.sections.includes(l.key)}
                onCheckedChange={(c) => toggleSection(l.key, Boolean(c))}
              />
              <label htmlFor={`sec-${l.key}`} className="min-w-0 flex-1 cursor-pointer">
                <div className="font-medium">{l.label}</div>
                <div className="text-[10px] text-muted-foreground">{l.hint}</div>
              </label>
              <button
                type="button"
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => only(l.key)}
                title={`Yalnız ${l.label.toLocaleLowerCase("tr")} bas`}
              >
                yalnız bu
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t pt-2.5">
        <div className="flex items-start gap-2">
          <Checkbox
            id="merge-sections"
            className="mt-0.5"
            checked={value.merge}
            onCheckedChange={(c) => onChange({ ...value, merge: Boolean(c) })}
          />
          <label htmlFor="merge-sections" className="min-w-0 flex-1 cursor-pointer">
            <div className="flex items-center gap-1.5 font-medium">
              <Layers className="h-3.5 w-3.5" /> Listeleri aynı sayfada birleştir
            </div>
            <div className="text-[10px] text-muted-foreground">
              Varsayılan kapalı: her liste kendi sayfasından başlar — çuval listesi
              1,5 sayfa tutarsa çeki listesi kalan yarım sayfaya sıkışmaz.
            </div>
          </label>
        </div>
      </div>

      {showRowNotes && (
        <div className="border-t pt-2.5">
          <div className="flex items-start gap-2">
            <Checkbox
              id="row-notes"
              className="mt-0.5"
              checked={value.rowNotes}
              onCheckedChange={(c) => onChange({ ...value, rowNotes: Boolean(c) })}
            />
            <label htmlFor="row-notes" className="min-w-0 flex-1 cursor-pointer">
              <div className="flex items-center gap-1.5 font-medium">
                <MessageSquareText className="h-3.5 w-3.5" /> Çuval notlarını göster
              </div>
              <div className="text-[10px] text-muted-foreground">
                İç not — varsayılan basılmaz. Kalıcı ayar değişmez; notu olan çuval
                yoksa etkisi olmaz.
              </div>
            </label>
          </div>
        </div>
      )}

      {showRowTags && (
        <div className="border-t pt-2.5">
          <div className="flex items-start gap-2">
            <Checkbox
              id="row-tags"
              className="mt-0.5"
              checked={value.rowTags}
              onCheckedChange={(c) => onChange({ ...value, rowTags: Boolean(c) })}
            />
            <label htmlFor="row-tags" className="min-w-0 flex-1 cursor-pointer">
              <div className="flex items-center gap-1.5 font-medium">
                <Tag className="h-3.5 w-3.5" /> Çuval izlerini (etiket) göster
              </div>
              <div className="text-[10px] text-muted-foreground">
                İç takip işareti — varsayılan basılmaz. ⚠️ Bu belge müşteriye gider.
                Kalıcı ayar değişmez; izi olan çuval yoksa etkisi olmaz.
              </div>
            </label>
          </div>
        </div>
      )}
    </>
  );
}
