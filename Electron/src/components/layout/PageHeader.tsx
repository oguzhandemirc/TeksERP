import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useFavorites } from "@/hooks/useFavorites";
import { findBreadcrumbParent, findCommandEntry } from "./command-entries";
import { useTabId } from "./tabs/tab-active";
import { canGoBackTab } from "./tabs/history-depth";

interface Props {
  /** Düz metin ya da hazır düğüm (ör. kutulu kimlik) — h1 içinde çizilir. */
  title: ReactNode;
  /** Başlığın hemen yanında (aynı satırda) gösterilen ek içerik — ör. durum rozeti. */
  titleExtra?: ReactNode;
  description?: string;
  actions?: ReactNode;
  className?: string;
  /** Sol geri-oku ikonu için AÇIK hedef (breadcrumb parent yoksa da göster; ör. detay
   *  sayfaları). Verilmezse sırayla: sekme geçmişinde bir adım geri → breadcrumb üstü. */
  onBack?: () => void;
  /** Breadcrumb üst bağlantısı — verilmezse route'tan otomatik çözülür. Kayıtlı command
   *  entry'si olmayan alt sayfalar (ör. iş emri oluştur/düzenle) için elle geçilir;
   *  `null` kırıntıyı GİZLER (kimliği başlıkta taşıyan detay yüzeyleri). */
  parent?: { label: string; to: string } | null;
  /** Sağdaki eylemlerin dikey hizası — kutulu/yüksek başlıklarda `center` (varsayılan üst). */
  actionsAlign?: "start" | "center";
}

export function PageHeader({ title, titleExtra, description, actions, className, onBack, parent: parentProp, actionsAlign = "start" }: Props) {
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const entry = findCommandEntry(pathname);
  const parent = parentProp === null ? null : (parentProp ?? findBreadcrumbParent(pathname));
  const { isFavorite, toggleFavorite } = useFavorites();
  const fav = isFavorite(pathname);

  /**
   * Sekmenin KENDİ geçmişinde geri gidilecek bir adım var mı?
   *
   * ⚠️ 2026-08-22 saha şikâyeti "geri tuşu çalışmıyor" TAM OLARAK buydu: her sekme
   * izole bir memory router'dır (`tabs/tab-routers.tsx`) ve menüden / hub'dan /
   * yeni sekmeden / oturum geri yüklemesinden açılan sekme DOĞRUDAN o sayfada
   * başlar → geçmiş TEK girişliktir ve `navigate(-1)` sessizce hiçbir şey yapmaz.
   * Düğme görünür, tıklanır, ekran durur.
   *
   * Uygunluk `location.key`'e BAKILARAK çözülemez: liste sayfaları açılışta
   * `setSearchParams(…, { replace: true })` ile varsayılan sekmeyi URL'e yazar,
   * bu yeni bir anahtar üretir ama geçmişe adım eklemez ("Tanımlar/Operasyon'da
   * çalışmıyor, Raporlar/Sistem'de çalışıyor" ayrımının sebebi buydu). Doğru
   * kaynak sekme başına tutulan derinlik defteridir. Sekme sistemi dışında
   * (gömülü kullanım/test) kimlik yoktur → anahtar sezgisine düşülür.
   */
  const tabId = useTabId();
  const canGoBack = tabId ? canGoBackTab(tabId) : location.key !== "default";

  /** Tek karar noktası: açık hedef > sekme geçmişi > mantıksal üst sayfa. */
  const goBack = () => {
    if (onBack) return onBack();
    if (canGoBack) return navigate(-1);
    if (parent) return navigate(parent.to);
  };
  // Üçünden biri varsa göster — yani çizilen ok HER ZAMAN bir şey yapar.
  const showBack = Boolean(onBack || parent || canGoBack);

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b bg-gradient-to-r from-primary/[0.07] via-transparent to-transparent px-6 py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-stretch gap-3">
        {showBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            aria-label="Geri"
            title="Geri"
            className="h-8 w-8 shrink-0 self-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <span className="my-0.5 w-1 shrink-0 rounded-full bg-primary/70" aria-hidden />
        <div className="min-w-0">
          {parent && (
            <button
              type="button"
              onClick={() => navigate(parent.to)}
              className="mb-0.5 flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {parent.label}
              <ChevronRight className="h-3 w-3 opacity-60" />
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            {titleExtra}
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {(entry || actions) && (
        <div className={cn("flex items-center gap-2", actionsAlign === "center" && "self-center")}>
          {entry && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleFavorite(pathname)}
              aria-label={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
              title={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
            >
              <Star
                className={cn("h-4 w-4", fav ? "fill-primary text-primary" : "text-muted-foreground")}
              />
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
