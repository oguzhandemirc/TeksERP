import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Sayfa iskeleti — TÜM sayfaların ortak kabı. Sekme paneli (TabHost) her sayfayı
 * `absolute inset-0 overflow-auto` ile sarar; bu yüzden bir sayfa kendi yüksekliğini
 * kısıtlamazsa TÜM panel kayar ve alttaki butonlar görünümden çıkar. PageShell
 * `flex h-full min-h-0 flex-col` ile paneli doldurur; sabit başlık/araç çubuğu/footer
 * arasında TEK bir kaydırılan gövde (PageBody) bırakılır.
 *
 * Konvansiyon (Electron/CLAUDE.md → "Sayfa İskeleti"):
 *   <PageShell>
 *     <PageHeader ... />                       // sabit (shrink-0, otomatik yükseklik)
 *     <SomeToolbar />                          // sabit chrome (arama/filtre)
 *     <PageBody className="p-6">...liste...</PageBody>   // TEK kaydırma bölgesi
 *     <PageFooter>...butonlar...</PageFooter>  // alta SABİTLENEN aksiyonlar (opsiyonel)
 *   </PageShell>
 *
 * DataTable tabanlı sayfalarda ayrı PageBody gerekmez — DataTable kendi kaydırma
 * bölgesini (flex-1 overflow-auto) ve pinlenen footer'ını (pagination) yönetir;
 * doğrudan PageShell'in flex-1 çocuğu olur.
 */
export const PageShell = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex h-full min-h-0 flex-col", className)} {...props} />
  ),
);
PageShell.displayName = "PageShell";

/**
 * Sayfanın TEK içsel kaydırma bölgesi — `flex-1 min-h-0 overflow-auto`. `min-h-0`
 * kritik: flex çocuğunun içerik boyutunun altına inebilmesi için (aksi halde gövde
 * içeriğe göre büyür ve panelin tamamı kayar → sabit başlık/footer bozulur). İç
 * boşluk için `className="p-6"` geç. Sonsuz kaydırma kökü olarak da kullanılır:
 * `useInfiniteScroll().rootRef`'i buraya bağla.
 */
export const PageBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("min-h-0 flex-1 overflow-auto", className)} {...props} />
  ),
);
PageBody.displayName = "PageBody";

/**
 * Alta SABİTLENEN aksiyon çubuğu — `shrink-0 border-t`. PageBody'den SONRA, PageShell'in
 * son çocuğu olarak konur; liste kayarken yerinde kalır. Varsayılan sağa hizalı;
 * `className="justify-between"` / `"justify-start"` ile ez.
 */
export const PageFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-background px-6 py-3",
        className,
      )}
      {...props}
    />
  ),
);
PageFooter.displayName = "PageFooter";
