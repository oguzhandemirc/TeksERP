import { Badge } from "@/components/ui/badge";
import type { LicenseDetail } from "@/types/license";
import { InfoRow, LicenseCard, day, when } from "./LicenseParts";
import { failureLabel } from "./labels";
import { LicenseFileUpload } from "./LicenseFileUpload";

type PaidThrough = NonNullable<LicenseDetail["durum"]["odenmisTarih"]>;

/** Ödenmiş tarih (P): süresiz ya da tarih; ufuktan geliyorsa bu bir ödeme değil çevrimdışı çalışma sınırıdır. */
function paidThroughText(p: PaidThrough): string {
  if (p.tarih === null) return "Süresiz";
  return p.kaynak === "UFUK" ? `${day(p.tarih)} (çevrimdışı çalışma sınırı)` : day(p.tarih);
}

/**
 * KİRA + yoklama + kapı zili — "en son ne zaman konuştuk" sorusu. v2 belgede süre ödenmiş tarihten (P)
 * sayılır; kira bitişi yalnız güncellik bilgisidir. Eski backend P ve bağlantı alanlarını göndermez.
 */
export function LicenseLeaseCard({ d, canManage = false }: { d: LicenseDetail; canManage?: boolean }) {
  const k = d.kira;
  const y = d.yoklama;
  const p = d.durum.odenmisTarih ?? null;
  const b = d.durum.baglanti;
  return (
    <LicenseCard
      title="Kira ve yoklama"
      action={<Badge variant={y.zil.bagli ? "secondary" : "muted"}>{y.zil.bagli ? "Zil bağlı" : "Zil kopuk"}</Badge>}
    >
      {k ? (
        <>
          {p && (
            <InfoRow label="Ödenmiş tarih">
              <span data-testid="lisans-odenmis-tarih">{paidThroughText(p)}</span>
            </InfoRow>
          )}
          <InfoRow label={p ? "Kira (güncellik)" : "Kira"}>
            {when(k.verilis)} → {when(k.bitis)}
          </InfoRow>
          {!p && k.gecerlilikBitis && <InfoRow label="Vade">{when(k.gecerlilikBitis)}</InfoRow>}
          <InfoRow label="Ek süre hakkı">{k.ekSureGun} gün</InfoRow>
          <InfoRow label="Kanal">{k.kanal.kod}</InfoRow>
          {k.yaptirim.mesaj && <InfoRow label="Satıcı mesajı">{k.yaptirim.mesaj}</InfoRow>}
          {k.yaptirim.guncellemeDonuk && <InfoRow label="Güncelleme">Donduruldu</InfoRow>}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Kira yok — kurulum etkinleşmemiş.</p>
      )}
      <div className="border-t pt-1.5" />
      {b && (
        <InfoRow label="Son kira alışverişi">
          <span data-testid="lisans-son-alisveris">
            {when(b.sonAlisveris)}
            {b.internetVar ? "" : " · 24 saatten eski"}
          </span>
        </InfoRow>
      )}
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
      {canManage && d.kurulum.etkin && <LicenseFileUpload />}
    </LicenseCard>
  );
}
