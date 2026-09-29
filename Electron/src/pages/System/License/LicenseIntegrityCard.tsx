import { Badge } from "@/components/ui/badge";
import type { IntegrityStatus, LicenseIntegrity } from "@/types/license";
import { InfoRow, LicenseCard, when } from "./LicenseParts";

const STATUS_LABEL: Record<IntegrityStatus, string> = {
  GECERLI: "Uyuşuyor",
  GECERSIZ: "Uyuşmuyor",
  OLCULEMEDI: "Ölçülemedi",
  KAPSAM_DISI: "İmzasız paket (geliştirme)",
};

const CORE_LABEL: Record<LicenseIntegrity["cekirdek"], string> = {
  native: "Native çekirdek",
  ts: "TS çekirdeği (geliştirme)",
  yok: "Çekirdek yüklenemedi",
};

// Kodlar backend'den (`integrity.ts` · `integrity-check.ts`); tanınmayan kod ham gösterilir.
const CODE_LABEL: Readonly<Record<string, string | undefined>> = {
  BUTUNLUK_UYUSMAZ: "Paketteki dosyalar değişmiş ya da eksik",
  BUTUNLUK_FAZLA: "Pakette listede olmayan dosya var",
  BUTUNLUK_LISTE_BOZUK: "İmzalı dosya listesi bozuk ya da eksik",
  BUTUNLUK_LISTE_YOK: "İmzalı dosya listesi yok",
  BUTUNLUK_OKUNAMADI: "Paket dosyaları okunamadı",
  BUTUNLUK_CAPA_BOS: "Paket imza anahtarı yok",
  BUTUNLUK_HAZIRLIK_ANAHTARI: "Hazırlık imzası üretim kurulumunda geçersiz",
  BUTUNLUK_SINIF_BILINMIYOR: "Kurulum sınıfı bilinmiyor (etkinleştirme bekleniyor)",
  BUTUNLUK_FILIGRAN: "Program filigranı imzalı paketle uyuşmuyor",
};

function statusVariant(s: IntegrityStatus): "secondary" | "destructive" | "outline" {
  if (s === "GECERSIZ") return "destructive";
  return s === "GECERLI" ? "secondary" : "outline";
}

/**
 * Lisans çekirdeği ve imzalı paket bütünlüğü — `license:view` ile detay ucundan. Dosya adı
 * gösterilmez (yalnız sayılar); ilk uyuşmazlık tarihi ek sürenin başladığı andır.
 */
export function LicenseIntegrityCard({ b }: { b: LicenseIntegrity | undefined }) {
  if (!b) {
    return (
      <LicenseCard title="Paket bütünlüğü">
        <p className="text-xs text-muted-foreground">Sunucu bu bilgiyi göndermiyor (eski sürüm).</p>
      </LicenseCard>
    );
  }
  const n = b.sayilar;
  return (
    <LicenseCard title="Paket bütünlüğü" action={<Badge variant={statusVariant(b.durum)}>{STATUS_LABEL[b.durum]}</Badge>}>
      <InfoRow label="Lisans çekirdeği">
        <span data-testid="lisans-cekirdek">{CORE_LABEL[b.cekirdek]}</span>
        {b.cekirdekNeden && <span className="block text-xs text-muted-foreground">{b.cekirdekNeden}</span>}
      </InfoRow>
      {b.kod && (
        <InfoRow label="Bulgu">
          <span className={b.durum === "GECERSIZ" ? "text-destructive" : undefined}>{CODE_LABEL[b.kod] ?? b.kod}</span>
        </InfoRow>
      )}
      <InfoRow label="Paket kimliği">
        <span className="font-mono text-xs" data-testid="lisans-paket-kimligi">
          {b.paketId ?? "—"}
        </span>
      </InfoRow>
      <InfoRow label="Paket sürümü">{b.paketSurumu ? `${b.paketSurumu} · ${when(b.derlemeTarihi)}` : "—"}</InfoRow>
      {n && (
        <InfoRow label="Dosyalar">
          {n.dosya} dosya · {n.eksik} eksik · {n.degisik} değişmiş · {n.fazla} fazla
          {n.okunamayan > 0 ? ` · ${n.okunamayan} okunamadı` : ""}
        </InfoRow>
      )}
      {b.ilkUyusmazlik && <InfoRow label="İlk uyuşmazlık">{when(b.ilkUyusmazlik)}</InfoRow>}
      <InfoRow label="Son denetim">{when(b.denetlendi)}</InfoRow>
    </LicenseCard>
  );
}
