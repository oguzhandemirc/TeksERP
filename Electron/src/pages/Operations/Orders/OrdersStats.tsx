import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  Factory,
  Ruler,
  SlidersHorizontal,
  Truck,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { OrderStats } from "./service";

export type OrderStatsView = "sade" | "onerilen" | "genis";

export const ORDER_STATS_VIEWS: Array<{ key: OrderStatsView; label: string; hint: string }> = [
  { key: "sade", label: "Sade", hint: "Adet ve durum rozetleri" },
  { key: "onerilen", label: "Önerilen", hint: "+ metraj ve geciken" },
  { key: "genis", label: "Geniş", hint: "+ iş emri, termin, tutar" },
];

// Envanter şeridiyle AYNI biçim: gruplama YOK. tr-TR'de binlik ayracı "."
// olduğu için `62.990` metraj alanında ondalık gibi okunuyor (RollsStats'ta da
// bu yüzden kapalı) — iki şerit yan yana farklı okunmamalı.
const NUM_FMT = new Intl.NumberFormat("tr-TR", { useGrouping: false });
const DEC_FMT = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });
const MONEY_FMT = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/** Durum kovası → etiket + ton. Sıra üretim akışını izler. */
const STATUS_ORDER = ["PENDING", "APPROVED", "PARTIAL_SHIPPED", "COMPLETED", "CANCELLED"] as const;
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Bekliyor",
  APPROVED: "Onaylı",
  PARTIAL_SHIPPED: "Kısmi Sevk",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
};
const STATUS_TONE: Record<string, string> = {
  PENDING: "text-amber-600 dark:text-amber-400",
  APPROVED: "text-sky-600 dark:text-sky-400",
  PARTIAL_SHIPPED: "text-violet-600 dark:text-violet-400",
  COMPLETED: "text-emerald-600 dark:text-emerald-400",
  // İptal bilerek SOLUK: listede zaten varsayılan gizli, göze girmemeli.
  CANCELLED: "text-muted-foreground",
};

/** Sevk bekleyen (terminal olmayan) durumlar — "geciken" kümesinin tanımı. */
const OPEN_STATUSES = "PENDING,APPROVED,PARTIAL_SHIPPED";

export interface OrdersStatsProps {
  data: OrderStats | undefined;
  isLoading: boolean;
  /** Hangi kümenin sayıldığı — "hangi 200 sipariş?" belirsizliğini kapatır. */
  scopeLabel: string;
  view: OrderStatsView;
  onViewChange: (v: OrderStatsView) => void;
  /** Tercih henüz yüklenmediyse mod değiştirme KAPALI (blob ezme koruması). */
  viewLocked: boolean;
  pricingEnabled: boolean;
  /** Rozet tıklaması — verilen filtreleri URL'e yazar (boş değer filtreyi siler). */
  onApplyFilter: (patch: Record<string, string | null>) => void;
}

/**
 * Sipariş listesi özet şeridi — envanterdeki `RollsStats`in sipariş karşılığı.
 *
 * ⚠️ ADET ile METRAJ farklı kümeleri sayar (backend `getOrderStats` başlığı):
 * adet listenin aynasıdır, metraj iptalleri her zaman dışlar. Şeritte ikisi
 * ayrı bloklarda durur; aynı satıra karıştırma.
 *
 * ⚠️ YERLEŞİM SÖZLEŞMESİ (2026-09-04, kullanıcı kararı — bekçi
 * `orders-layout.guard.test.tsx`):
 *  - Şerit **her zaman tam genişlik** (`w-full`) ve sola dayalı; sayfada
 *    filtre satırının ÜSTÜNDE durur. Eskiden `flex justify-end` içinde
 *    içeriği kadar yer kaplıyordu, yani "geniş" moda geçince sağa doğru
 *    büyüyüp sol yarıyı boş bırakıyordu.
 *  - Ayar açılırı (`ml-auto`) satırın EN SAĞINDA kalır.
 *  - İçerik İKİ EKSENDE çözülür: **görünüm modu TAVAN, pencere genişliği
 *    TABAN.** Kullanıcı "Geniş" seçse de dar pencerede ayrıntı grupları
 *    gizlenir (`lg` = metraj, `2xl` = tutar/termin/iş emri). Böylece şerit
 *    dar pencerede üç satıra taşmaz. Gizlenen şey yalnız GÖRÜNÜM — sayılar
 *    aynı sorgudan gelir, hiçbir rakamın tanımı değişmez.
 */
export function OrdersStats({
  data,
  isLoading,
  scopeLabel,
  view,
  onViewChange,
  viewLocked,
  pricingEnabled,
  onApplyFilter,
}: OrdersStatsProps) {
  if (isLoading && !data) {
    return <span className="text-xs text-muted-foreground">Özet yükleniyor…</span>;
  }
  if (!data) return null;

  const showQty = view !== "sade";
  const showExtras = view === "genis";
  const currencies = Object.entries(data.amountByCurrency);

  return (
    <div
      data-testid="orders-stats"
      className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border border-primary/25 bg-primary/5 px-3 py-1.5 shadow-sm"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
        {scopeLabel}
      </span>
      <Divider />

      <Stat icon={ClipboardList} value={NUM_FMT.format(data.totalCount)} unit="sipariş" />

      {/* METRAJ kademesi — `lg` (≥1024px) altında gizli. Üç sayı + üç birim
          etiketi tek başına ~330px yer kaplar; dar pencerede şeridi ikinci
          satıra taşıyan ilk şey budur. */}
      {showQty && (
        <div
          data-testid="orders-stats-qty"
          className="hidden items-center gap-x-2.5 lg:flex"
        >
          <Divider />
          <Stat icon={Ruler} value={DEC_FMT.format(data.totalOrderedQty)} unit="m istendi" />
          <Stat icon={Truck} value={DEC_FMT.format(data.totalShippedQty)} unit="m sevk" />
          <Stat
            icon={Ruler}
            value={DEC_FMT.format(data.totalOpenQty)}
            unit="m açık"
            emphasis
          />
        </div>
      )}

      {/* TUTAR kademesi — `2xl` (≥1536px). Para birimi başına bir blok doğar,
          yani en oynak genişlikteki grup; en son o düşer. */}
      {showExtras && currencies.length > 0 && pricingEnabled && (
        <div
          data-testid="orders-stats-money"
          className="hidden items-center gap-x-2.5 2xl:flex"
        >
          <Divider />
          {currencies.map(([cur, amount]) => (
            <Stat key={cur} value={MONEY_FMT.format(amount)} unit={cur} />
          ))}
        </div>
      )}

      <Divider />

      {STATUS_ORDER.filter((s) => data.byStatus[s] != null).map((s) => (
        <Chip
          key={s}
          label={STATUS_LABEL[s] ?? s}
          count={data.byStatus[s]!}
          tone={STATUS_TONE[s] ?? ""}
          onClick={() => onApplyFilter({ "filter[status]": s })}
        />
      ))}

      {showQty && data.overdueCount > 0 && (
        <Chip
          icon={AlertTriangle}
          label="Geciken"
          count={data.overdueCount}
          tone="text-destructive"
          // Backend sayacın tanımıyla BİREBİR aynı küme: açık statüler +
          // termini bugünden önce. Var olmayan bir filtre uydurulmuyor.
          onClick={() =>
            onApplyFilter({
              "filter[status]": OPEN_STATUSES,
              dateField: "deadline",
              dateFrom: null,
              dateTo: new Date().toISOString(),
            })
          }
        />
      )}

      {/* TERMİN + İŞ EMRİ kademesi — tutarla aynı eşik (`2xl`). Her iki sayaç
          da 0 ise grup HİÇ doğmaz: boş bir flex çocuğu bile `gap` üretir. */}
      {showExtras && (data.dueThisWeekCount > 0 || data.noWorkOrderCount > 0) && (
        <div
          data-testid="orders-stats-extra"
          className="hidden items-center gap-x-2.5 2xl:flex"
        >
          {data.dueThisWeekCount > 0 && (
            <Chip
              icon={CalendarClock}
              label="Bu hafta"
              count={data.dueThisWeekCount}
              tone="text-amber-600 dark:text-amber-400"
              onClick={() =>
                onApplyFilter({
                  "filter[status]": OPEN_STATUSES,
                  dateField: "deadline",
                  dateFrom: new Date().toISOString(),
                  dateTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                })
              }
            />
          )}
          {data.noWorkOrderCount > 0 && (
            <Chip
              icon={Factory}
              label="İş emri yok"
              count={data.noWorkOrderCount}
              tone="text-muted-foreground"
              onClick={() => onApplyFilter({ "filter[woState]": "NONE" })}
            />
          )}
        </div>
      )}

      {/* Ayarlar HER ZAMAN en sağda — şerit tam genişlik olduğu için `ml-auto`
          olmadan sola yapışıp rozetlerin arasında kaybolurdu. */}
      <div data-testid="orders-stats-view" className="ml-auto flex items-center gap-x-2.5">
        <Divider />
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={viewLocked}
            title={viewLocked ? "Tercihler yükleniyor…" : "Özet görünümü"}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-primary/10 hover:text-foreground disabled:opacity-50"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {ORDER_STATS_VIEWS.find((v) => v.key === view)?.label}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Özet görünümü</DropdownMenuLabel>
            {ORDER_STATS_VIEWS.map((v) => (
              <DropdownMenuCheckboxItem
                key={v.key}
                checked={view === v.key}
                onCheckedChange={() => onViewChange(v.key)}
              >
                <span className="flex flex-col">
                  <span>{v.label}</span>
                  <span className="text-[10px] text-muted-foreground">{v.hint}</span>
                </span>
              </DropdownMenuCheckboxItem>
            ))}
            {/* "Geniş seçtim ama tutar yok" sorusunun cevabı burada yazılı
                durmalı — yoksa gizlenen grup hata gibi okunur. */}
            <p className="px-2 pb-1 pt-1 text-[10px] text-muted-foreground">
              Pencere daraldıkça ayrıntılar otomatik gizlenir.
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  value,
  unit,
  emphasis,
}: {
  icon?: LucideIcon;
  value: string;
  unit: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {Icon ? <Icon className="h-3.5 w-3.5 text-primary" /> : null}
      <span
        className={cn(
          "text-sm font-bold tabular-nums",
          emphasis ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground">{unit}</span>
    </div>
  );
}

function Chip({
  icon: Icon,
  label,
  count,
  tone,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  count: number;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} — listeyi bu duruma süz`}
      className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-primary/10"
    >
      {Icon ? <Icon className={cn("h-3.5 w-3.5", tone)} /> : null}
      <span className={cn("text-sm font-bold tabular-nums", tone)}>{NUM_FMT.format(count)}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </button>
  );
}

function Divider() {
  return <span className="h-3.5 w-px bg-primary/20" aria-hidden />;
}
