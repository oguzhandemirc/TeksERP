import { useNavigate } from "react-router-dom";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LicenseCard } from "./LicenseParts";

/**
 * Eylem geçmişi — kim, ne zaman etkinleştirdi/aktardı/taşıdı. Ayak izi SystemLog'da
 * durur ve onu okuyan istemci yüzeyleri beyanlıdır (`test_audit_okuma_kaynagi`,
 * allowlist yönetici onayıyla); bu kart okumaz, beyanlı ekrana yönlendirir:
 * Sistem Kayıtları → olay türü "Lisans işlemi" (ve diğer `LICENSE_*` olayları).
 */
export function LicenseHistoryCard() {
  const navigate = useNavigate();
  return (
    <LicenseCard title="Eylem geçmişi">
      <p className="text-sm text-muted-foreground">
        Etkinleştirme, aktarma, taşıma, DR ve proxy işlemleri kimin yaptığıyla birlikte Sistem
        Kayıtları'nda tutulur. Olay türünden <strong>Lisans işlemi</strong>, durum değişimleri için
        <strong> Lisans durumu değişti</strong> seçin.
      </p>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => navigate("/system/logs")}>
          <ScrollText className="mr-1.5 h-4 w-4" /> Sistem Kayıtları
        </Button>
      </div>
    </LicenseCard>
  );
}
