import { useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UpdateStatus as UpdaterStatus } from "@shared/ipc-contract";
import { ALLOWED_UPDATE_HOST, validateFeedOverride } from "@shared/update-feed";
import { useUpdater } from "@/hooks/useUpdater";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useClientPolicy } from "@/hooks/useClientPolicy";
import { isBelowMinimum } from "@/lib/version-compare";
import { SETTINGS_ADMIN_PERMISSION } from "@/pages/GeneralSettings/settings-config";
import { InfoRow, LicenseCard as DetailCard, when } from "../License/LicenseParts";

/** Adres kutusu: yayın adresi pakete derlemede gömülür; yanlış gömülürse tek çıkış bu makinede ezmektir. */
function FeedEditor({ initial, onSave, onCancel }: { initial: string; onSave: (url: string | null) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const save = async () => {
    const next = draft.trim();
    const v = next ? validateFeedOverride(next) : null;
    if (v && !v.ok) {
      toast.error(v.reason);
      return;
    }
    try {
      await onSave(v ? v.url : null);
    } catch {
      toast.error("Güncelleme adresi kabul edilmedi (yalnız izinli https adresi).");
      return;
    }
    onCancel();
    toast.success(next ? "Güncelleme adresi bu bilgisayar için değiştirildi" : "Varsayılan adrese dönüldü");
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`https://${ALLOWED_UPDATE_HOST}/<grup>/electron/`} className="h-8 min-w-[280px] flex-1 font-mono text-xs" />
      <Button size="sm" onClick={() => void save()}>
        Kaydet
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Vazgeç
      </Button>
    </div>
  );
}

/**
 * Ayrıntılar → "Bu bilgisayar": son denetim, sunucunun istediği en düşük sürüm, yayın adresi ve grubu.
 * Adres ezmesi YALNIZ `admin:settings` (arayüz kapısı; asıl kural ana süreçte: https + izinli ana makine).
 */
export function PanelUpdateDetails() {
  const { status, setFeedUrl } = useUpdater();
  // Tarayıcıda (güncelleyici yok) kart da, sunucu politikası sorusu da yok.
  return status ? <PanelDetailsCard status={status} setFeedUrl={setFeedUrl} /> : null;
}

function PanelDetailsCard({ status, setFeedUrl }: { status: UpdaterStatus; setFeedUrl: (url: string | null) => Promise<void> }) {
  const policy = useClientPolicy();
  const canEditFeed = useRoleAccess().hasPermission(SETTINGS_ADMIN_PERMISSION);
  const [editing, setEditing] = useState(false);
  const below = policy ? isBelowMinimum(status.currentVersion, policy.minVersion) : false;
  return (
    <DetailCard title="Bu bilgisayar">
      <InfoRow label="Son denetim">{status.lastCheckedAt ? when(status.lastCheckedAt) : "Henüz denetlenmedi"}</InfoRow>
      {policy && <InfoRow label="Sunucunun istediği">{`en az ${policy.minVersion}${below ? " — bu sürüm desteklenmiyor" : " ✓"}`}</InfoRow>}
      <InfoRow label="Güncelleme grubu">
        <span data-guncelleme-grubu="">{status.grup ?? "bilinmiyor"}</span>
      </InfoRow>
      <InfoRow label="Güncelleme adresi">
        <span className="break-all font-mono text-xs">{status.feedUrl || "—"}</span>
        <span className="block text-[11px] text-muted-foreground">
          {status.feedUrlOverridden ? "Bu bilgisayara özel adres (varsayılan değil)." : "Varsayılan adres — lisanstaki güncelleme grubundan."}
        </span>
      </InfoRow>
      {canEditFeed &&
        (editing ? (
          <FeedEditor initial={status.feedUrlOverridden ? status.feedUrl : ""} onSave={setFeedUrl} onCancel={() => setEditing(false)} />
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {status.feedUrlOverridden && (
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void setFeedUrl(null)}>
                <RotateCcw className="h-3.5 w-3.5" />
                Varsayılana dön
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Adresi değiştir
            </Button>
          </div>
        ))}
    </DetailCard>
  );
}
