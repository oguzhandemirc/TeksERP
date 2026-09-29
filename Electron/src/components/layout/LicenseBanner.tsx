import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { cn } from "@/lib/utils";
import type { Banner } from "@/types/license";

const TONE: Record<Banner["ton"], { box: string; icon: typeof Info }> = {
  bilgi: { box: "border-info/30 bg-info/10 text-foreground", icon: Info },
  uyari: { box: "border-warning/40 bg-warning/10 text-foreground", icon: AlertTriangle },
  tehlike: { box: "border-destructive/40 bg-destructive/10 text-foreground", icon: ShieldAlert },
};

/**
 * Küresel lisans şeridi — backend'in UYGULADIĞI bant (`GET /durum`.bant).
 *
 * Metni panel üretmez; gözlem kipinde backend bandı daima `null` döndürür, yani
 * bu bileşen gözlemde HİÇ çizilmez (sıfır fark). Şerit, modal değil: yarım
 * kalmış formu kaybettirmez (`ServerOfflineBanner` kalıbı).
 */
export function LicenseBanner() {
  const status = useLicenseStatus();
  const bant = status?.bant ?? null;
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
      className={cn("flex shrink-0 items-center gap-3 border-b px-4 py-1.5 text-xs", t.box)}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{bant.metin}</span>
      {days && <span className="shrink-0 font-medium tabular-nums">{days}</span>}
    </div>
  );
}
