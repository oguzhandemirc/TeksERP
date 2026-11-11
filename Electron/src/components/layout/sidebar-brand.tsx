import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/teks-logo-fullsize.png";
import { useCompanyName } from "@/hooks/usePricingEnabled";
import { useUpdater } from "@/hooks/useUpdater";
import { guncellemeRozeti } from "@/lib/updater-durum";
import { RELEASE_NOTES_PATH } from "@/pages/ReleaseNotes/release-notes-path";
import { useAppVersion } from "@/hooks/useAppVersion";
import { IS_ELECTRON } from "@/lib/runtime-env";
import { useTabsStore } from "@/store/tabs";
import { useServerClock } from "@/hooks/useServerClock";
import { factoryDateTimeFormat } from "@/lib/factory-time";

// Sunucu saatini yerel TZ'de biçimlendiren sabit formatlayıcılar (tek-site'de
// client TZ = sunucu TZ → sunucunun duvar saati). Modül seviyesinde 1 kez kurulur.
const dateFmt = () => factoryDateTimeFormat("tr-TR", { day: "2-digit", month: "short" });
const timeFmt = () => factoryDateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const fullFmt = () => factoryDateTimeFormat("tr-TR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Marka altındaki gerçek durum + sunucu saati satırı (statik "Sistem aktif"in
 * yerine). Yeşil nabız = online, kırmızı = bağlantı yok, gri = bağlanıyor.
 * Saat sunucu offset'iyle dakika başında tik atar. Küçük yaprak — re-render izole.
 */
function SidebarServerStatus() {
  const { status, serverDate } = useServerClock();

  if (status === "offline") {
    return (
      <span
        title="Sunucuya ulaşılamıyor"
        className="flex items-center gap-1.5 text-[10px] font-medium leading-tight text-destructive"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
        Bağlantı yok
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="flex items-center gap-1.5 text-[10px] font-medium leading-tight text-sidebar-muted">
        <span className="h-2 w-2 shrink-0 rounded-full bg-sidebar-muted/40" />
        Bağlanıyor…
      </span>
    );
  }
  return (
    <span
      title={`Sunucu saati · ${fullFmt().format(serverDate)}`}
      className="flex items-center gap-1.5 text-[10px] font-medium leading-tight text-sidebar-muted"
    >
      <span className="live-dot shrink-0" />
      {dateFmt().format(serverDate)} · {timeFmt().format(serverDate)}
    </span>
  );
}

/** Ürün adı — uygulama markası (firma adından bağımsız, footer'da gösterilir). */
const PRODUCT_NAME = "TeksERP";

/** Uygulama sürümünü main process'ten okur (window.api.appInfo.version). */
/** Marka başlığı — logo; genişken firma adı (dinamik) + sunucu saati/bağlantı durumu. */
export function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const companyName = useCompanyName();
  return (
    // Geniş kabukta pencere başlığı bu alandır (mac trafik ışıkları üstünde durur → üst boşluk).
    <div
      className={cn(
        "sidebar-brand-mac app-drag relative flex min-h-16 shrink-0 items-center",
        collapsed ? "justify-center px-2" : "gap-3 px-5",
      )}
    >
      <img
        src={logoUrl}
        alt=""
        className="relative h-9 w-9 shrink-0 rounded-xl object-cover shadow-soft"
      />
      {!collapsed && (
        <div className="relative flex min-w-0 flex-col">
          <span
            title={companyName}
            className="truncate text-sm font-bold leading-tight tracking-tight"
          >
            {companyName}
          </span>
          <SidebarServerStatus />
        </div>
      )}
    </div>
  );
}

/** Footer — ürün adı + sürüm ve güncellik durumu; tıklanınca sürüm notları açılır.
 *  Daraltılmışta "EY" (sürüm tooltip'te). */
const VENDOR_URL = "https://etkiliyazilim.com";

/** Üretici bağlantısı: Electron'da `openExternal` köprüsü (beyanlı https listesi); webde köprü
 *  yok (ölü düğme olurdu) → düz bağlantı, yeni sekmede. */
function VendorLink(props: { title: string; className: string; children: ReactNode; "aria-label"?: string }) {
  const { children, ...rest } = props;
  if (!IS_ELECTRON) {
    return (
      <a href={VENDOR_URL} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={() => void window.api?.system?.openExternal(VENDOR_URL)} {...rest}>
      {children}
    </button>
  );
}

export function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const version = useAppVersion();
  const { status } = useUpdater();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  // ⚠️ Eşleme tek kaynaktan (`@/lib/updater-durum`) — eskiden bu dosyada ve
  // `SurumRozeti`de BİREBİR kopyalanmıştı; kopyalar ayrışsa aynı makine aynı
  // anda iki farklı şey derdi.
  const guncellik = IS_ELECTRON ? guncellemeRozeti(status?.state) : null;

  if (collapsed) {
    return (
      <div className="flex justify-center border-t border-sidebar-border py-3">
        <VendorLink
          aria-label="Etkili Yazılım"
          title={`${PRODUCT_NAME}${version ? ` v${version}` : ""} · etkiliyazilim.com`}
          className="text-[10px] font-medium tracking-wider text-sidebar-muted transition-colors hover:text-sidebar-foreground"
        >
          EY
        </VendorLink>
      </div>
    );
  }
  return (
    <div className="border-t border-sidebar-border px-5 py-3">
      {/* Sürüm artık tooltip'te değil GÖRÜNÜR: "hangi sürümü kullanıyorum" ve
          "güncel miyim" soruları sahada en sık sorulan iki sorudur. Tıklama
          sürüm notlarını açar — sürümü görüp "bunda ne var?" diyen kişi için
          doğal yol. */}
      <button
        type="button"
        onClick={() => navigateActive(RELEASE_NOTES_PATH)}
        title="Sürüm notları — bu sürümde neler değişti"
        className="block w-full truncate text-left text-[10px] font-semibold leading-tight text-sidebar-muted transition-colors hover:text-sidebar-foreground"
      >
        {PRODUCT_NAME}
        {version ? ` v${version}` : ""}
        {guncellik ? <span className={guncellik.sinif}> · {guncellik.metin}</span> : null}
      </button>
      <VendorLink title="etkiliyazilim.com" className="text-[10px] text-sidebar-muted transition-colors hover:text-sidebar-foreground">
        by Etkili Yazılım
      </VendorLink>
    </div>
  );
}
