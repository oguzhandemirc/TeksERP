// Kişi kartı → Bildirimler: tek tür satırı. Uygulama içi anahtarı yönetici kişi adına değiştirir; kilitli türde ve
// kişinin göremediği türde PASİF, gerekçe metinle (renk tek başına anlam taşımaz).
import { Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { UserPrefChannel, UserPrefKind } from "@/services/bildirimProfilService";

const SIDE: Array<{ kanal: UserPrefChannel["kanal"]; ad: string }> = [
  { kanal: "OZET", ad: "Gün özeti" },
  { kanal: "MASAUSTU", ad: "Masaüstü" },
  { kanal: "TABLET_SES", ad: "Tablet sesi" },
  { kanal: "PATRON_PUSH", ad: "Patron telefonu" },
];

/** Yönetici bakışıyla kaynak: kişinin bu türü NEDEN aldığı/almadığı. */
export function adminSourceLabel(kaynak: string): string {
  if (kaynak.startsWith("profil:")) return `"${kaynak.slice(7)}" bildirim profili`;
  if (kaynak === "fabrika") return "Fabrika varsayılanı";
  if (kaynak === "kullanici") return "Kişisel seçim";
  return "Görev (yetki) varsayılanı";
}

export function UserNotificationRow(p: {
  k: UserPrefKind;
  pending: boolean;
  onToggle: (acik: boolean) => void;
  onReset: () => void;
}) {
  const { k, pending } = p;
  if (!k.gorur) {
    return (
      <li className="flex items-start justify-between gap-3 py-2.5" data-testid={`kisi-tur-${k.tur}`}>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{k.ad}</p>
          <p className="text-xs text-muted-foreground">{k.gizliNeden}</p>
        </div>
        <Switch checked={false} disabled onCheckedChange={() => {}} aria-label={`${k.ad} — açılamaz: ${k.gizliNeden ?? ""}`} />
      </li>
    );
  }
  const app = k.kanallar.find((c) => c.kanal === "UYGULAMA");
  const side = SIDE.flatMap((s) => {
    const c = k.kanallar.find((x) => x.kanal === s.kanal);
    return c ? [`${s.ad} ${c.durum === "ACIK" ? "açık" : "kapalı"}`] : [];
  });
  return (
    <li className="flex items-start justify-between gap-3 py-2.5" data-testid={`kisi-tur-${k.tur}`}>
      <div className="min-w-0 space-y-0.5">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {app?.kilit && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
          {k.ad}
        </p>
        <p className="text-xs text-muted-foreground">
          {app?.durum === "ACIK" ? "Alıyor" : "Almıyor"} · Neden: {app ? adminSourceLabel(app.kaynak) : "—"}
          {app?.kilit ? " · kilitli (kapatılamaz)" : ""}
        </p>
        {side.length > 0 && <p className="text-[11px] text-muted-foreground">{side.join(" · ")}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {app?.kisisel && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={pending} onClick={p.onReset} title="Kişisel seçimi kaldır; profil/fabrika/görev varsayılanı geçerli olur">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Varsayılana dön
          </Button>
        )}
        <Switch
          checked={app?.durum === "ACIK"}
          disabled={pending || !app || app.kilit}
          onCheckedChange={p.onToggle}
          aria-label={`${k.ad} — uygulama içi${app?.kilit ? " (kilitli)" : ""}`}
        />
      </div>
    </li>
  );
}
