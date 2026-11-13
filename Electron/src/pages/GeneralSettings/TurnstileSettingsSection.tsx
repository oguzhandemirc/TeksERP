// İnternetten Giriş → "Tarayıcı girişinde robot doğrulaması" (Cloudflare Turnstile, V1c). Yalnız tarayıcı
// girişini etkiler; masaüstü panel, tablet ve patron telefonu sorulmaz. Anahtarsız açma sunucuda 400.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PermissionGate } from "@/components/PermissionGate";
import { FieldLabel } from "./SettingRow";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";
import { TURNSTILE_QUERY_KEY, getTurnstileSettings, updateTurnstileSettings } from "./turnstileSettings";

export function TurnstileSettingsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: TURNSTILE_QUERY_KEY, queryFn: getTurnstileSettings, retry: false });
  const [enabled, setEnabled] = useState(false);
  const [siteKey, setSiteKey] = useState("");
  useEffect(() => {
    if (!q.data) return;
    setEnabled(q.data.enabled);
    setSiteKey(q.data.siteKey ?? "");
  }, [q.data]);
  const dirty = q.data !== undefined && (enabled !== q.data.enabled || siteKey.trim() !== (q.data.siteKey ?? ""));
  const mut = useMutation({
    mutationFn: () => updateTurnstileSettings({ enabled, siteKey: siteKey.trim() || null }),
    onSuccess: (view) => {
      qc.setQueryData(TURNSTILE_QUERY_KEY, view);
      toast.success(view.enabled ? "Robot doğrulaması açıldı." : "Robot doğrulaması kapalı.");
    },
    // onError YOK: 400 (anahtar eksik) metnini apiClient tek toast'la basar.
  });
  if (!q.data) return null;
  const v = q.data;
  return (
    <PermissionGate anyOf={[SETTINGS_ADMIN_PERMISSION]} fallback={null}>
      <div className="mt-6 space-y-3 border-t pt-4" data-testid="turnstile-settings">
        <div className="flex items-center justify-between gap-4">
          <FieldLabel
            htmlFor="turnstile-enabled"
            label="Tarayıcı girişinde robot doğrulaması"
            desc="Cloudflare Turnstile. Yalnız tarayıcıdan girişte sorulur; masaüstü panel, tablet ve patron telefonu etkilenmez."
          />
          <Switch id="turnstile-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <Input
          aria-label="Site anahtarı"
          placeholder="Site anahtarı (Cloudflare → Turnstile)"
          value={siteKey}
          onChange={(e) => setSiteKey(e.target.value)}
          className="max-w-md font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Gizli anahtar: {v.secretConfigured ? "sunucuda tanımlı" : "tanımlı değil (sunucuda TURNSTILE_SECRET_KEY)"}
          {!v.webPanelMode && " · Bu sunucu tarayıcı paneli sunmuyor, ayar etkisiz."}
        </p>
        {dirty && (
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>Kaydet</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setEnabled(v.enabled); setSiteKey(v.siteKey ?? ""); }} disabled={mut.isPending}>Vazgeç</Button>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
