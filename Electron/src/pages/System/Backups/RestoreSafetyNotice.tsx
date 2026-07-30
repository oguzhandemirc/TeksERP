import { Callout } from "@/components/ui/callout";
import type { RestoreImpact } from "./restore-impact.types";

function humanDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} saniye`;
  return `${Math.floor(s / 60)} dk ${s % 60} sn`;
}

/**
 * Güvenlik yedeği + acil çıkış. Komut bloğu, güvenlik yedeği DOĞRULANMADAN
 * `pg_restore`'u çalıştırmaz; bu bileşen o davranışı ve tek meşru kaçış yolunu
 * anlatır.
 *
 * Acil çıkışın belgelenmesi bilinçli bir karardır: veritabanı zaten bozuksa
 * `pg_dump` da patlar — yani katı guard, geri yüklemeye EN ÇOK ihtiyaç duyulan
 * anda operatörü durdurur. Kaçışı gizlemek, baskı altında blokun elle
 * parçalanmasına (ve yanlış satırın çalıştırılmasına) yol açar.
 */
export function RestoreSafetyNotice({
  impact,
  lastBackupDurationMs,
}: {
  impact: RestoreImpact;
  lastBackupDurationMs?: number | null;
}) {
  const safe = impact.safetyBackup;
  return (
    <div className="space-y-2">
      <Callout tone="info" title="Geri yüklemeden önce güvenlik yedeği alınır">
        Komut bloğu ilk olarak mevcut veritabanının tam yedeğini alır ve{" "}
        <code>pg_restore --list</code> ile <b>doğrular</b>. Doğrulama başarısız olursa{" "}
        <b>geri yükleme ÇALIŞMAZ</b> — yanlış yedeğe döndüğünüzü fark ederseniz bu dosyayla
        geri dönebilirsiniz.
        {safe && (
          <>
            {" "}
            Dosya: <code className="font-mono text-xs">{safe.fileName}</code>
          </>
        )}
        <br />
        <span className="text-xs">
          Bu dosya <code>pre-restore_</code> ön ekli olduğu için 14'lük rotasyona{" "}
          <b>girmez</b> (otomatik silinmez). Offsite kopyası <b>alınmaz</b> — makine dışı
          kopya istiyorsanız elle taşıyın.
        </span>
        {lastBackupDurationMs != null && lastBackupDurationMs > 0 && (
          <>
            <br />
            <span className="text-xs">
              Önceki yedek {humanDuration(lastBackupDurationMs)} sürdü — güvenlik yedeği
              kesintiyi yaklaşık o kadar uzatacak.
            </span>
          </>
        )}
      </Callout>

      <details className="rounded-lg border px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium">
          Acil durum: veritabanı okunamıyorsa ne yapılır?
        </summary>
        <p className="mt-1.5 text-muted-foreground">
          Veritabanı zaten bozuksa güvenlik yedeği de alınamaz ve blok geri yüklemeyi
          reddeder. Bu bilinçli: normal durumda güvenlik ağı olmadan devam edilmemeli.
          Gerçekten mecbursanız, kırmızı hatayı gördükten sonra <code>$ok = $true</code>{" "}
          satırını elle çalıştırıp bloğun geri yükleme satırını tekrar koşturun —{" "}
          <b>geri dönüş noktanız olmayacağını</b> kabul ederek.
        </p>
      </details>
    </div>
  );
}
