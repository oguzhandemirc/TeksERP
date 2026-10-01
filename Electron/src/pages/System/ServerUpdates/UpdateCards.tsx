import { Badge } from "@/components/ui/badge";
import type { UpdateStatus } from "@/types/server-update";
import { InfoRow, LicenseCard as UpdateCard, when } from "../License/LicenseParts";
import {
  decisionText,
  localStateLabel,
  modeLabel,
  progressPercent,
  resultCodeLabel,
  resultLabel,
  updaterLabel,
  windowRuleText,
} from "./labels";

/** Kurulu sürüm + bekleyen (erişilebilir) sürüm ve güncelleyicinin onun için kararı. */
export function VersionCard({ s }: { s: UpdateStatus }) {
  const p = s.bekleyen;
  const k = s.karar;
  return (
    <UpdateCard title="Sürüm" action={p?.zorunlu ? <Badge variant="destructive">Kritik güncelleme</Badge> : undefined}>
      <InfoRow label="Kurulu sürüm">{s.kuruluSurum}</InfoRow>
      <InfoRow label="Yeni sürüm">{p && p.surum !== s.kuruluSurum ? p.surum : "Yok"}</InfoRow>
      {p && <InfoRow label="Durum">{decisionText(p.karar, p.neden)}</InfoRow>}
      {!p && k && <InfoRow label="Durum">{decisionText(k.karar, k.neden)}</InfoRow>}
      {p?.aralik && p.karar === "PENCERE_BEKLIYOR" && <InfoRow label="Kurulum">{when(p.aralik.baslangic)}</InfoRow>}
      {p?.pgGuncellemesi && <InfoRow label="PostgreSQL">Önce küçük sürüm güncellemesi yapılacak</InfoRow>}
      {p?.ozet && p.surum !== s.kuruluSurum && <p className="whitespace-pre-line pt-1 text-xs text-muted-foreground">{p.ozet}</p>}
    </UpdateCard>
  );
}

/** Kiradaki politika (satıcı imzalı) — kip, pencere, sabitleme, sıradaki pencere. */
export function PolicyCard({ s }: { s: UpdateStatus }) {
  const p = s.politika;
  return (
    <UpdateCard title="Politika" action={p ? <Badge variant="muted">{p.kaynak === "KIRA" ? "Kiradan" : "Varsayılan"}</Badge> : undefined}>
      {p ? (
        <>
          <InfoRow label="Kip">{modeLabel(p.kip)}</InfoRow>
          <InfoRow label="Pencere">{p.pencere ? windowRuleText(p.pencere) : "Tanımlı değil"}</InfoRow>
          {s.sonrakiPencere && <InfoRow label="Sıradaki pencere">{`${when(s.sonrakiPencere.baslangic)} – ${when(s.sonrakiPencere.bitis)}`}</InfoRow>}
          {p.hedefSurum && <InfoRow label="Sabitlenen sürüm">{p.hedefSurum}</InfoRow>}
          {s.donuk && <InfoRow label="Yaptırım">Güncellemeler durduruldu</InfoRow>}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Geçerli kira yok — güncelleme kapalı.</p>
      )}
      {s.kanal && <InfoRow label="Kanal">{s.kanal}</InfoRow>}
    </UpdateCard>
  );
}

/** Güncelleyici hizmeti: canlılık (kalp atışı) + şu anki işi. */
export function UpdaterCard({ s }: { s: UpdateStatus }) {
  const g = s.guncelleyici;
  const y = s.yerel;
  const pct = progressPercent(y?.ilerleme ?? null);
  const variant = g.durum === "CALISIYOR" ? "secondary" : g.durum === "YOK" ? "muted" : "destructive";
  return (
    <UpdateCard title="Güncelleyici" action={<Badge variant={variant}>{updaterLabel(g.durum)}</Badge>}>
      {s.canlilik?.sonCanlilik && <InfoRow label="Son sinyal">{when(s.canlilik.sonCanlilik)}</InfoRow>}
      {g.surum && <InfoRow label="Güncelleyici sürümü">{g.surum}</InfoRow>}
      {y && <InfoRow label="İş">{localStateLabel(y.durum)}</InfoRow>}
      {y?.adim && <InfoRow label="Adım">{y.adim}</InfoRow>}
      {pct !== null && <InfoRow label="İndirme">{`%${pct}`}</InfoRow>}
      {y?.mesaj && <p className="pt-1 text-xs text-muted-foreground">{y.mesaj}</p>}
    </UpdateCard>
  );
}

/** Son tamamlanan deneme ve (varsa) geri dönüşün nedeni. */
export function LastResultCard({ s }: { s: UpdateStatus }) {
  const r = s.son;
  const detail = s.yerel?.sonAyrinti ?? null;
  return (
    <UpdateCard title="Son güncelleme">
      {r ? (
        <>
          <InfoRow label="Sonuç">{resultLabel(r.sonuc)}</InfoRow>
          <InfoRow label="Sürüm">{r.kaynakSurum ? `${r.kaynakSurum} → ${r.hedefSurum}` : r.hedefSurum}</InfoRow>
          <InfoRow label="Zaman">{`${when(r.baslangic)} – ${when(r.bitis)}`}</InfoRow>
          {r.kod && <InfoRow label="Neden">{resultCodeLabel(r.kod)}</InfoRow>}
          {r.sonuc !== "BASARILI" && <InfoRow label="Veri">{r.veriGeriYuklendi ? "Güncelleme öncesi yedekten geri yüklendi" : "Değişmedi"}</InfoRow>}
          {r.sonuc !== "BASARILI" && detail?.mesaj && (
            <p className="pt-1 text-xs text-muted-foreground" data-testid="geri-donus-ayrinti">
              {detail.hataKodu ? `${detail.hataKodu}: ` : ""}
              {detail.mesaj}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Bu sunucuda henüz güncelleme yapılmadı.</p>
      )}
    </UpdateCard>
  );
}
