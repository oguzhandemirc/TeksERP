// Liste sayfası standardı (Gelen Belgeler / Kumaş Stoğu düzeni) — DataTable kullanmayan, kendi <table>'ını çizen
// liste sayfaları için aynı iskelet: sabit üst bant → kenardan kenara TEK kaydırıcı (yapışkan başlık) → durum altlığı.
// Tablo kart (rounded + border + dış boşluk) içine KONMAZ; bekçi: src/test/liste-standardi.test.ts.
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Üst bant — KPI/özet şeridi, durum çipleri, süzgeç girdileri ve sağda araçlar. Sabittir (kaymaz).
 * Sıra Gelen Belgeler ile aynı: özet → çipler → girdiler (+ `ml-auto` araçlar).
 */
export function ListToolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 flex-col gap-2 border-b px-4 py-2", className)} {...props} />;
}

/**
 * Yapışkan başlık + DataTable'daki mor ayraç. Ayraç th ARKA PLANINDA: `border-collapse`ta tr kenarlığı sticky
 * başlıkla birlikte durmaz (DataTable.tsx'teki notla aynı neden).
 */
const STICKY_HEAD =
  "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card [&_thead_th]:bg-[linear-gradient(to_top,hsl(var(--primary)_/_0.3)_2px,transparent_2px)]";

/**
 * Listenin TEK kaydırıcısı — PageBody'nin dolgusuz, tam genişlik hâli. Sonsuz kaydırmada
 * `useInfiniteScroll().rootRef` buraya, `sentinelRef` en sondaki `<ListSentinel>`e bağlanır.
 */
export const ListBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} data-list-body="" className={cn("min-h-0 flex-1 overflow-auto", STICKY_HEAD, className)} {...props} />
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

const n = (v: number) => v.toLocaleString("tr-TR", { useGrouping: false });

/** Alt şerit — "Yüklü X / Y kayıt" + yükleniyor / tümü yüklendi. DataTable altlığı da bunu çizer (tek görünüm). */
export function ListFooter({ loaded, total, hasMore, isFetchingMore = false, label, children }: StatusProps) {
  return (
    <div
      data-list-footer=""
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
