import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/teks-logo-fullsize.png";
import { useCompanyName } from "@/hooks/usePricingEnabled";
import { useServerClock } from "@/hooks/useServerClock";

// Sunucu saatini yerel TZ'de biçimlendiren sabit formatlayıcılar (tek-site'de
// client TZ = sunucu TZ → sunucunun duvar saati). Modül seviyesinde 1 kez kurulur.
const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" });
const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("tr-TR", {
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
      <span className="flex items-center gap-1.5 text-[10px] font-medium leading-tight text-muted-foreground">
        <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />
        Bağlanıyor…
      </span>
    );
  }
  return (
    <span
      title={`Sunucu saati · ${fullFmt.format(serverDate)}`}
      className="flex items-center gap-1.5 text-[10px] font-medium leading-tight text-muted-foreground"
    >
      <span className="live-dot shrink-0" />
      {dateFmt.format(serverDate)} · {timeFmt.format(serverDate)}
    </span>
  );
}

/** Ürün adı — uygulama markası (firma adından bağımsız, footer'da gösterilir). */
const PRODUCT_NAME = "TeksERP";

/** Uygulama sürümünü main process'ten okur (window.api.appInfo.version). */
function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const p = window.api?.appInfo?.version?.();
    if (p) void p.then((v) => active && setVersion(v)).catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return version;
}

/** Marka başlığı — gradient accent bandı + logo; genişken firma adı (dinamik) + canlı "Sistem aktif" nabzı. */
export function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const companyName = useCompanyName();
  return (
    <div
      className={cn(
        "relative flex h-14 shrink-0 items-center overflow-hidden border-b border-border/50",
        collapsed ? "justify-center px-2" : "gap-2.5 px-4",
      )}
    >
      {/* Marka rengiyle yumuşak köşe parıltısı — sidebar'a kimlik katar. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent" />
      <img
        src={logoUrl}
        alt=""
        className="relative h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-primary/30"
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

/** Footer — ürün adı + sürüm üstte, "by Etkili Yazılım" dış bağlantısı altta.
 *  Daraltılmışta "EY" (sürüm tooltip'te). */
export function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const version = useAppVersion();
  const handleClick = () => {
    void window.api?.system?.openExternal("https://etkiliyazilim.com");
  };

  if (collapsed) {
    return (
      <div className="flex justify-center border-t border-border/50 py-3">
        <button
          type="button"
          onClick={handleClick}
          aria-label="Etkili Yazılım"
          title={`${PRODUCT_NAME}${version ? ` v${version}` : ""} · etkiliyazilim.com`}
          className="text-[10px] font-medium tracking-wider text-muted-foreground/50 transition-colors hover:text-foreground"
        >
          EY
        </button>
      </div>
    );
  }
  return (
    <div className="border-t border-border/50 px-4 py-3">
      <p
        className="truncate text-[10px] font-semibold leading-tight text-muted-foreground"
        title={version ? `${PRODUCT_NAME} · sürüm ${version}` : PRODUCT_NAME}
      >
        {PRODUCT_NAME}
      </p>
      <button
        type="button"
        onClick={handleClick}
        title="etkiliyazilim.com"
        className="text-[10px] text-muted-foreground/50 transition-colors hover:text-foreground"
      >
        by Etkili Yazılım
      </button>
    </div>
  );
}
