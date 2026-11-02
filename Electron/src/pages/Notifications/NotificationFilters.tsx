// Bildirimler sayfası sol süzgeci — durum (sunucu sekmesi) + alan grubu (katalog türleri → `filter[tur]`).
// Süzme SUNUCUDA yapılır; burada yalnız seçim tutulur. Dar ekranda sayfanın üstüne iner.
import { cn } from "@/lib/utils";
import { groupLook } from "@/lib/bildirim/format";
import type { NotificationGroup, NotificationTab } from "@/lib/bildirim/types";

export type PageTab = Extract<NotificationTab, "tumu" | "okunmamis" | "alarmlar" | "ertelenen">;

const STATUS_OPTIONS: Array<{ k: PageTab; ad: string; aciklama: string }> = [
  { k: "tumu", ad: "Tümü", aciklama: "Ertelenenler hariç" },
  { k: "okunmamis", ad: "Okunmamış", aciklama: "Henüz açmadıklarınız (alarmlar hariç)" },
  { k: "alarmlar", ad: "Alarmlar", aciklama: "Size bildirilen tezgah alarmları (açık ve kapanan)" },
  { k: "ertelenen", ad: "Ertelenen", aciklama: "Süresi dolunca geri gelir" },
];

export function NotificationFilters({
  sekme,
  onSekme,
  gruplar,
  seciliGruplar,
  onGrupDegis,
}: {
  sekme: PageTab;
  onSekme: (s: PageTab) => void;
  gruplar: readonly NotificationGroup[];
  seciliGruplar: ReadonlySet<NotificationGroup>;
  onGrupDegis: (g: NotificationGroup | null) => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 border-b p-3 lg:w-60 lg:overflow-y-auto lg:border-b-0 lg:border-r" aria-label="Süzgeç">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Durum</legend>
        <div className="flex flex-wrap gap-1 lg:flex-col">
          {STATUS_OPTIONS.map((d) => (
            <button
              key={d.k}
              type="button"
              aria-pressed={sekme === d.k}
              onClick={() => onSekme(d.k)}
              title={d.aciklama}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                sekme === d.k ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {d.ad}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Alan
        </legend>
        <div className="flex flex-wrap gap-1 lg:flex-col">
          <button
            type="button"
            aria-pressed={seciliGruplar.size === 0}
            onClick={() => onGrupDegis(null)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
              seciliGruplar.size === 0 ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            Tüm alanlar
          </button>
          {gruplar.map((g) => {
            const gg = groupLook(g);
            const Ikon = gg.ikon;
            const secili = seciliGruplar.has(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={secili}
                onClick={() => onGrupDegis(g)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                  secili ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                <span className={cn("flex h-5 w-5 items-center justify-center rounded", gg.renk)}>
                  <Ikon className="h-3.5 w-3.5" aria-hidden />
                </span>
                {g}
              </button>
            );
          })}
        </div>
      </fieldset>
    </aside>
  );
}
