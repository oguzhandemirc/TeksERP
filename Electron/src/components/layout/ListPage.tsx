// Liste sayfası standardı (Gelen Belgeler / Kumaş Stoğu düzeni) — DataTable kullanmayan, kendi <table>'ını çizen
// liste sayfaları için aynı iskelet: sabit üst bant → kenardan kenara TEK kaydırıcı (yapışkan başlık) → durum altlığı.
// Sayfa tabloyu kendi kartına SARMAZ (bekçi: src/test/liste-standardi.test.ts); kart görünümü iskelettedir:
// bu parçalar `data-list-surface` taşır, index.css "liste yüzeyi koşusu" ardışık parçaları tek kart gibi boyar.
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDisplay } from "@/lib/format";

/**
 * Üst bant — KPI/özet şeridi, durum çipleri, süzgeç girdileri ve sağda araçlar. Sabittir (kaymaz).
 * Sıra Gelen Belgeler ile aynı: özet → çipler → girdiler (+ `ml-auto` araçlar).
 */
export function ListToolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-list-surface="toolbar" className={cn("flex shrink-0 flex-col gap-2 border-b px-4 py-2", className)} {...props} />;
}

/**
 * Liste bandı — özet şeridi gibi listenin üstündeki tam genişlik bilgi satırı. Çerçevesiz; zemin `--band`, ince alt
 * çizgi (index.css "SAYFA BANTLARI"). İçine konan şerit kendi kutusunu ÇİZMEZ.
 */
export function ListBand({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-list-band="" className={cn("shrink-0 py-1.5", className)} {...props} />;
}

export interface BandStatItem {
  key: string;
  label: ReactNode;
  /** Ham sayı ortak gösterim biçimiyle basılır ("4.295"); metin/düğüm olduğu gibi. */
  value: ReactNode;
  /** Birim eki ("m", "kg", "top") — değerin yanında soluk. */
  unit?: string;
  tone?: "danger" | "warn" | "success";
  /** Değerin yanına ek (ör. "1.137 m" ikinci bilgi). */
  hint?: ReactNode;
  /** Açıklama ipucu. */
  title?: string;
}

const TONE_CLASS: Record<NonNullable<BandStatItem["tone"]>, string> = {
  danger: "text-destructive",
  warn: "text-warning",
  success: "text-success",
};

/**
 * Bant içi özet sayıları — liste sayfalarının TEK özet görünümü (kutu/kart çizmez; bant zemininde ince ayraçlı satır).
 * `scope` sayılan kümeyi söyler ("Depo", "Bu ay"); `children` sağa dayalı ek (çipler, emanet payı).
 */
export function BandStats({ items, scope, label, children, className }: { items: BandStatItem[]; scope?: ReactNode; label: string; children?: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} data-band-stats="" className={cn("flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 text-sm", className)}>
      {scope != null && <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">{scope}</span>}
      {items.map((it) => (
        <span key={it.key} title={it.title} className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-xs text-muted-foreground">{it.label}</span>
          <span className={cn("font-semibold tabular-nums text-foreground", it.tone && TONE_CLASS[it.tone])}>
            {typeof it.value === "number" ? formatDisplay(it.value) : it.value}
          </span>
          {it.unit && <span className="text-xs text-muted-foreground">{it.unit}</span>}
          {it.hint != null && <span className="text-xs tabular-nums text-muted-foreground">{it.hint}</span>}
        </span>
      ))}
      {children}
    </div>
  );
}

/**
 * Yapışkan başlık + DataTable'daki ince ayraç. Ayraç th ARKA PLANINDA: `border-collapse`ta tr kenarlığı sticky
 * başlıkla birlikte durmaz (DataTable.tsx'teki notla aynı neden).
 */
const STICKY_HEAD =
  "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card [&_thead_th]:bg-[linear-gradient(to_top,hsl(var(--border))_1px,transparent_1px)]";

/**
 * Listenin TEK kaydırıcısı — PageBody'nin dolgusuz, tam genişlik hâli. Sonsuz kaydırmada
 * `useInfiniteScroll().rootRef` buraya, `sentinelRef` en sondaki `<ListSentinel>`e bağlanır.
 */
export const ListBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} data-list-body="" data-list-surface="body" className={cn("min-h-0 flex-1 overflow-auto", STICKY_HEAD, className)} {...props} />
));
ListBody.displayName = "ListBody";

/** Yükleniyor / hata / boş mesajı — kenara yapışmasın diye yalnız mesaj dolgulu durur (tablo değil). */
export function ListMessage({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 sm:p-6", className)} {...props} />;
}

/** Sonsuz kaydırma hedefi — görünmez; durum yazısı altlıkta (ListFooter). */
export const ListSentinel = forwardRef<HTMLDivElement, object>(function ListSentinel(_props, ref) {
  return <div ref={ref} aria-hidden className="h-px w-full shrink-0" />;
});

interface StatusProps {
  /** Ekrandaki (yüklü) satır sayısı. */
  loaded: number;
  /** Süzgecin toplamı (aynı where'den); bilinmiyorsa yalnız yüklü sayı yazılır. */
  total?: number | null;
  /** Sonraki sayfa var mı (sonsuz kaydırma). Verilmezse durum yazısı çizilmez (sayfasız / numaralı liste). */
  hasMore?: boolean;
  isFetchingMore?: boolean;
  /** Sol metni değiştirir (ör. numaralı sayfalamada "12 sayım · sayfa 1/3"). */
  label?: ReactNode;
  /** Sağdaki eylemler (ör. "Tümünü indir", sayfa boyu seçici, Önceki/Sonraki). */
  children?: ReactNode;
}

const n = (v: number) => formatDisplay(v, 0);

/** Alt şerit — "Yüklü X / Y kayıt" + yükleniyor / tümü yüklendi. DataTable altlığı da bunu çizer (tek görünüm). */
export function ListFooter({ loaded, total, hasMore, isFetchingMore = false, label, children }: StatusProps) {
  return (
    <div
      data-list-footer=""
      data-list-surface="footer"
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground"
    >
      <div>{label ?? (total != null ? `Yüklü ${n(loaded)} / ${n(total)} kayıt` : `Yüklü ${n(loaded)} kayıt`)}</div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
        {isFetchingMore ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Yükleniyor…
          </span>
        ) : hasMore === false ? (
          <span>Tüm kayıtlar yüklendi</span>
        ) : null}
        {children}
      </div>
    </div>
  );
}
