import { Badge } from "@/components/ui/badge";
import type { LicenseDetail, ModuleCeiling } from "@/types/license";
import { InfoRow, LicenseCard, day } from "./LicenseParts";
import { CLASS_LABEL, moduleSettingLabel } from "./labels";

function ceilingText(c: ModuleCeiling): string {
  if (!c.applies) return "Uygulanmıyor";
  const denied = c.denied.length ? ` · dondurulan: ${c.denied.map(moduleSettingLabel).join(", ")}` : "";
  return (c.allowed === null ? "Yalnız dondurma" : "Lisanstaki modüller") + denied;
}

/** HAK — yapısal şartlar: sahibi, sınıfı, modül tavanı, bakım bitişi. */
export function LicenseEntitlementCard({ d }: { d: LicenseDetail }) {
  const h = d.hak;
  if (!h) {
    return (
      <LicenseCard title="Lisans hakkı">
        <p className="text-sm text-muted-foreground">Bu kurulumun doğrulanmış bir lisans hakkı yok.</p>
      </LicenseCard>
    );
  }
  return (
    <LicenseCard title="Lisans hakkı" action={<Badge variant="outline">{h.lisansNo}</Badge>}>
      <InfoRow label="Lisans sahibi">
        {h.musteri.ad} · {h.tesis.ad}
      </InfoRow>
      <InfoRow label="Sınıf">{CLASS_LABEL[h.sinif] ?? h.sinif}</InfoRow>
      <InfoRow label="Süre">{h.kalici ? "Kalıcı" : "Süreli"}</InfoRow>
      <InfoRow label="Bakım bitişi">{day(h.bakimBitis)}</InfoRow>
      <InfoRow label="Veriliş">{day(h.verilis)} · sürüm {h.surum}</InfoRow>
      <InfoRow label="Modül tavanı (hesaplanan)">{ceilingText(d.durum.hesaplanan.modulTavani)}</InfoRow>
      <div className="flex flex-wrap gap-1 pt-1">
        {h.moduller.map((m) => (
          <Badge key={m} variant="muted">
            {moduleSettingLabel(m)}
          </Badge>
        ))}
      </div>
    </LicenseCard>
  );
}
