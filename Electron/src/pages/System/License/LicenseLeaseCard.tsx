import { Badge } from "@/components/ui/badge";
import type { LicenseDetail } from "@/types/license";
import { InfoRow, LicenseCard, when } from "./LicenseParts";
import { failureLabel } from "./labels";

/** KİRA + yoklama + kapı zili — "en son ne zaman konuştuk" sorusu. */
export function LicenseLeaseCard({ d }: { d: LicenseDetail }) {
  const k = d.kira;
  const y = d.yoklama;
  return (
    <LicenseCard
      title="Kira ve yoklama"
      action={<Badge variant={y.zil.bagli ? "secondary" : "muted"}>{y.zil.bagli ? "Zil bağlı" : "Zil kopuk"}</Badge>}
    >
      {k ? (
        <>
          <InfoRow label="Kira">
            {when(k.verilis)} → {when(k.bitis)}
          </InfoRow>
          {k.gecerlilikBitis && <InfoRow label="Vade">{when(k.gecerlilikBitis)}</InfoRow>}
          <InfoRow label="Ek süre hakkı">{k.ekSureGun} gün</InfoRow>
          <InfoRow label="Kanal">{k.kanal.kod}</InfoRow>
          {k.yaptirim.mesaj && <InfoRow label="Satıcı mesajı">{k.yaptirim.mesaj}</InfoRow>}
          {k.yaptirim.guncellemeDonuk && <InfoRow label="Güncelleme">Donduruldu</InfoRow>}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Kira yok — kurulum etkinleşmemiş.</p>
      )}
      <div className="border-t pt-1.5" />
      <InfoRow label="Lisans sunucusu">{y.saticiYapilandirildi ? y.saticiAdresi : "Tanımlı değil"}</InfoRow>
      <InfoRow label="Son yoklama">{when(y.sonDeneme)}</InfoRow>
      <InfoRow label="Son başarı">{when(y.sonBasari)}</InfoRow>
      {y.sonBasarisizlik && (
        <InfoRow label="Son hata">
          {when(y.sonBasarisizlik)} · {failureLabel(y.sonHataKodu)}
        </InfoRow>
      )}
      <InfoRow label="Sonraki yoklama">{when(y.sonrakiDeneme)}</InfoRow>
      <InfoRow label="Son zil / kalp atışı">
        {when(y.zil.sonZil)} / {when(y.zil.sonKalpAtisi)}
      </InfoRow>
    </LicenseCard>
  );
}
