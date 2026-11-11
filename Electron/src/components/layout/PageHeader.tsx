import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Info, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useFavorites } from "@/hooks/useFavorites";
import { findBreadcrumbParent, findCommandEntry } from "./command-entries";
import { useTabId } from "./tabs/tab-active";
import { canGoBackTab } from "./tabs/history-depth";

interface Props {
  /** Düz metin ya da hazır düğüm (ör. kutulu kimlik) — h1 içinde çizilir. */
  title: ReactNode;
  /** Başlığın hemen yanında (aynı satırda) gösterilen ek içerik — ör. durum rozeti. */
  titleExtra?: ReactNode;
  /** Sayfanın ne işe yaradığı — başlık altında ÇİZİLMEZ (K24), başlığın yanındaki ⓘ ipucunda
   *  durur; ⓘ'nin erişilebilir adı metnin kendisidir. */
  description?: string;
  /** Başlık altında GÖRÜNÜR kalan kayıt bağlamı/durum satırı (ör. "Müşteri · Şube",
   *  "Tür · Rota") — açıklama değil veridir; ipucuna gizlenmez. */
  statusLine?: ReactNode;
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
  /** Genel sayfa favorisi yıldızı — kendi favori düğmesini taşıyan yüzey (v2 rapor yaprağı) kapatır; iki yıldız yan yana çizilmesin. */
  pageFavorite?: boolean;
}

export function PageHeader({ title, titleExtra, description, statusLine, actions, className, onBack, parent: parentProp, actionsAlign = "start", pageFavorite = true }: Props) {
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const entry = pageFavorite ? findCommandEntry(pathname) : undefined;
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
      data-page-header=""
      className={cn(
        // flex-wrap: dar ekranda eylemler alt satıra iner; başlık sütunu kelime kelime kırılmaz (UX-3 R3).
        // Yeni görünüm: başlık lavanta zeminde, kenarlıksız; içerik kartları altında başlar.
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 md:px-6 md:pt-5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-[1_1_16rem] items-stretch gap-3">
        {showBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            aria-label="Geri"
            title="Geri"
            className="h-9 w-9 shrink-0 self-center rounded-lg border border-card-border bg-card text-muted-foreground shadow-soft hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex min-w-0 flex-col justify-center">
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
            <h1 className="break-words text-xl font-bold tracking-tight">{title}</h1>
            {description && <HeaderInfo text={description} />}
            {titleExtra}
          </div>
          {statusLine && <p className="text-sm text-muted-foreground">{statusLine}</p>}
        </div>
      </div>
      {(entry || actions) && (
        <div className={cn("ml-auto flex max-w-full flex-wrap items-center justify-end gap-2", actionsAlign === "center" && "self-center")}>
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

/** Başlık yanındaki ⓘ — açıklama satırı yer kaplamasın diye ipucunda (K24, LockInfo kalıbı). */
function HeaderInfo({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={text}
            data-testid="page-header-info"
            className="inline-flex shrink-0 rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-sm whitespace-normal leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
