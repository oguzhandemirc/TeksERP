import { useShipmentManualSackCountEnabled } from "@/hooks/usePricingEnabled";

/**
 * ARACA YÜKLENEN GERÇEK ÇUVAL ADEDİ — sevk KURULUM anındaki beyan.
 *
 * ⚠️ NEDEN KURULUM ANINDA (2026-09-07 saha açıklaması): yurtiçi sevkte mal
 * çuvallara AYRILMIYOR — tartı gerekmediği için 100 top tek çuval kaydına
 * yazılıp gönderiliyor. Sistem "1 çuval" sayıyor, araca 10 çuval çıkıyor ve bu
 * fark ne ekranda ne İRSALİYEDE görünüyordu. Çuvallara ayırma + tartı yalnız
 * ihracatta yapılıyor.
 *
 * Alan sevkiyat DETAYINDA zaten vardı (`ManualSackCountEditor`); eksik olan
 * giriş ANIydı — kamyon yüklenirken sayı bilinir, üç ekran sonra hatırlanmaz.
 *
 * ⚠️ BURASI YAZMAZ: değeri çağırana verir, kayıt sevkiyat kurulduktan SONRA
 * `setManualSackCount` ile yazılır. Alan bir ANNOTATION'dır (donmuş belge
 * çekirdeğine girmez, sürüm doğurmaz), o yüzden ayrı yazım meşrudur.
 *
 * Bayrak kapalıysa hiç çizilmez (`shipping.manualSackCountEnabled`).
 */
export function ShipmentSackCountField({
  value,
  onChange,
  /** Sistemin saydığı çuval KAYDI adedi — beyanın neyi düzelttiği görünsün. */
  systemCount,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  systemCount: number;
  invalid: boolean;
}) {
  const enabled = useShipmentManualSackCountEnabled();
  if (!enabled) return null;

  return (
    <div className="rounded-md border p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sm font-medium">Araca yüklenen çuval adedi</span>
        <span className="text-xs text-muted-foreground">
          · sistem {systemCount} çuval kaydı sayıyor
        </span>
      </div>
      <input
        type="number"
        min={1}
        max={9999}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="boş = beyan yok"
        aria-label="Araca yüklenen çuval adedi"
        className="h-9 w-40 rounded-md border bg-background px-2 text-sm"
      />
      <p className="mt-1.5 text-xs text-muted-foreground">
        Mal tek çuval kaydına yazılıp birden çok çuvalla gönderiliyorsa fiili sayıyı buraya yazın —{" "}
        <strong>irsaliyeye basılır</strong>. Boş bırakırsanız belgede yalnız sistemin saydığı rakam
        çıkar. Sonradan sevkiyat detayından da düzeltebilirsiniz.
      </p>
      {invalid && <p className="mt-1 text-xs text-destructive">1 ile 9999 arasında bir sayı girin.</p>}
    </div>
  );
}
