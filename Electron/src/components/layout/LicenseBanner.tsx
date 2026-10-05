import { useEffect, useState } from "react";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { cn } from "@/lib/utils";
import type { Banner } from "@/types/license";

const TONE: Record<Banner["ton"], { box: string; icon: typeof Info }> = {
  bilgi: { box: "border-info/30 bg-info/10 text-foreground", icon: Info },
  uyari: { box: "border-warning/40 bg-warning/10 text-foreground", icon: AlertTriangle },
  tehlike: { box: "border-destructive/40 bg-destructive/10 text-foreground", icon: ShieldAlert },
};

/** Birden çok mesaj varsa her biri bu kadar görünür, sonra sıradakine geçilir. */
export const BANNER_ROTATE_MS = 6000;

/**
 * Küresel lisans şeridi — backend'in UYGULADIĞI bant(lar) (`GET /durum`.bantlar; yoksa tek `bant`).
 * TEK alan: birden çok mesaj sırayla döner, geçişte metin animasyonla girer; fare üstündeyken durur.
 *
 * Metni panel üretmez; gözlem kipinde backend yalnız beyanlı bilgi bandını (K9 bakım
 * hatırlatması) döndürür, başka her bant `null`dır — panel kipe bakmadan backend'in dediğini çizer. Şerit, modal değil: yarım
 * kalmış formu kaybettirmez (`ServerOfflineBanner` kalıbı).
 */
export function LicenseBanner() {
  const status = useLicenseStatus();
  const list = status?.bantlar?.length ? status.bantlar : status?.bant ? [status.bant] : [];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = list.length;
  useEffect(() => {
    if (count < 2 || paused) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), BANNER_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [count, paused]);
  const bant = list[count === 0 ? 0 : index % count];
  if (!bant) return null;
  const t = TONE[bant.ton];
  const Icon = t.icon;
  const days =
    status?.kademe === "EK_SURE" && status.ekSureKalanGun !== null
      ? `Ek süre: ${status.ekSureKalanGun} gün`
      : status?.kisitlamaKalanGun !== null && status?.kisitlamaKalanGun !== undefined
        ? `Kısıtlamaya ${status.kisitlamaKalanGun} gün`
        : null;
  return (
    <div
      role="status"
      data-testid="lisans-bandi"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn("flex shrink-0 items-center gap-3 border-b px-4 py-1.5 text-xs transition-colors duration-300", t.box)}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span key={`${index}:${bant.metin}`} className="lisans-bandi-gecis min-w-0 flex-1 truncate">
        {bant.metin}
      </span>
      {count > 1 && (
        <span data-testid="lisans-bandi-sira" className="shrink-0 tabular-nums text-muted-foreground">
          {(index % count) + 1}/{count}
        </span>
      )}
      {days && <span className="shrink-0 font-medium tabular-nums">{days}</span>}
    </div>
  );
}
