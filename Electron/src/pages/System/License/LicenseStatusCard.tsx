import { Badge } from "@/components/ui/badge";
import type { LicenseDetail } from "@/types/license";
import { InfoRow, LicenseCard, when } from "./LicenseParts";
import { MODE_LABEL, TIER_LABEL, VALIDITY_LABEL, reasonLabel } from "./labels";

/**
 * Hesaplanan ↔ uygulanan ayrımı ekranın ana cümlesidir: gözlemde motor her şeyi
 * hesaplar ama fabrikaya UYGULANAN kademe NORMAL kalır (sıfır fark).
 */
export function LicenseStatusCard({ d }: { d: LicenseDetail }) {
  const s = d.durum;
  const observe = s.kip === "gozlem";
  return (
    <LicenseCard
      title="Durum"
      action={
        <Badge variant={s.gecerlilik === "GECERLI" ? "secondary" : "destructive"}>{VALIDITY_LABEL[s.gecerlilik]}</Badge>
      }
    >
      <InfoRow label="Kip">{MODE_LABEL[s.kip]}</InfoRow>
      <InfoRow label="Hesaplanan kademe">{TIER_LABEL[s.hesaplananKademe]}</InfoRow>
      <InfoRow label="Uygulanan kademe">{TIER_LABEL[s.uygulananKademe]}</InfoRow>
      {s.ekSureKalanGun !== null && <InfoRow label="Ek süre">{s.ekSureKalanGun} gün kaldı</InfoRow>}
      {s.kisitlamaKalanGun !== null && <InfoRow label="Kısıtlamaya">{s.kisitlamaKalanGun} gün</InfoRow>}
      {s.yaptirimKademesi && <InfoRow label="Satıcı yaptırımı">{s.yaptirimKademesi}</InfoRow>}
      {s.devredildi && <InfoRow label="DR">Üretim DR sunucusuna devredildi</InfoRow>}
      {s.hesaplanan.bant && <InfoRow label={observe ? "Zorlamada bant" : "Bant"}>{s.hesaplanan.bant.metin}</InfoRow>}
      <InfoRow label="Güvenilir saat">
        {when(s.saat.guvenilir)} · {s.saat.kaynak}
        {s.saat.bulgu ? ` · ${reasonLabel(s.saat.bulgu)}` : ""}
      </InfoRow>
      {observe && (
        <InfoRow label="Gözlem sayacı">
          {d.gozlem.reddedilecekIstek} istek · {d.gozlem.reddedilecekModul} modül reddedilirdi
        </InfoRow>
      )}
      {s.nedenler.length > 0 && (
        <ul className="mt-2 space-y-1 border-t pt-2 text-xs">
          {s.nedenler.map((n) => (
            <li key={n.kod}>
              <span className="font-medium">{reasonLabel(n.kod)}</span>
              {n.ayrinti ? <span className="text-muted-foreground"> — {n.ayrinti}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </LicenseCard>
  );
}
