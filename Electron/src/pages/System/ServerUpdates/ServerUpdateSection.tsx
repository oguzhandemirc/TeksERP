import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useTabsStore } from "@/store/tabs";
import { InfoRow, LicenseCard as UpdateCard, when } from "../License/LicenseParts";
import { TIER_LABEL } from "../License/labels";
import { useServerUpdateStatus } from "./hooks";
import { updaterLabel } from "./labels";

/**
 * "Sunucu Durumu" ekranının hizmet bölümü: backend · veritabanı · güncelleyici · lisans. Sürüm, onay ve geçmiş
 * Güncellemeler sayfasındadır (tek yer) — burada yalnız oraya bağlantı. Kaynak `GET /api/guncelleme/durum`
 * (izin `license:view ∨ license:manage`); izinsiz kullanıcıda bölüm hiç çizilmez, eski backend'de sessizce yok olur.
 */
export function ServerUpdateSection({ db }: { db: "UP" | "DOWN" | null }) {
  const { hasPermission } = useRoleAccess();
  const q = useServerUpdateStatus(hasPermission("license:manage") || hasPermission("license:view"));
  const lic = useLicenseStatus();
  const navigateActive = useTabsStore((st) => st.navigateActive);
  const s = q.data;
  if (!s) return null;
  const g = s.guncelleyici;
  return (
    <section data-testid="sunucu-guncelleme-bolumu">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Hizmetler</h2>
      {g.durum === "DURDU" && (
        <Callout tone="danger" title="Son güncelleme geri alınamadı — müdahale gerekiyor">
          Güncelleyici yeni bir onay gelene dek işlem başlatmaz; destekle görüşmeden yeniden denemeyin.
        </Callout>
      )}
      <div className="mt-3 grid gap-4 xl:grid-cols-2">
        <UpdateCard title="Hizmetler">
          <InfoRow label="Backend">{`Çalışıyor · ${s.kuruluSurum}`}</InfoRow>
          <InfoRow label="Veritabanı">{db === null ? "—" : db === "UP" ? "Bağlı" : "Bağlantı yok"}</InfoRow>
          <InfoRow label="Güncelleyici">
            <Badge variant={g.durum === "CALISIYOR" ? "secondary" : g.durum === "YOK" ? "muted" : "destructive"}>{updaterLabel(g.durum)}</Badge>
            {s.canlilik?.sonCanlilik ? ` · son sinyal ${when(s.canlilik.sonCanlilik)}` : ""}
          </InfoRow>
          <InfoRow label="Lisans">{lic ? `${TIER_LABEL[lic.kademe]}${lic.lisansNo ? ` · ${lic.lisansNo}` : ""}` : "—"}</InfoRow>
          <button type="button" className="pt-1 text-xs text-primary underline-offset-2 hover:underline" onClick={() => navigateActive("/system/updates")}>
            Sürüm ve güncellemeler →
          </button>
        </UpdateCard>
      </div>
    </section>
  );
}
