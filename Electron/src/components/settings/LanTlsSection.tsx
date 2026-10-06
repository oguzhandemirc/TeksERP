import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Lock, LockOpen, ShieldCheck } from "lucide-react";
import type { DiscoveryApi } from "@shared/ipc-contract";
import { formatFingerprintGroups, type TlsPin, type TlsPinVia } from "@shared/lan-tls";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { applyApiBaseUrl, pushRecentApiBaseUrl, setStoredApiBaseUrl } from "@/lib/api-config";
import { activePinFor, httpFallbackUrl, planTlsSwitch, type TlsSwitchPlan } from "@/lib/lan-tls-ui";

interface Props {
  /** Diyalogda görünen adres (kaydedilmemiş olabilir). */
  url: string;
  recent: string[];
  /** Adres şifreli/şifresiz kanala geçti ve kaydedildi. */
  onAddressChanged: (url: string) => void;
  /** Kaydı engellenen şifresiz geçiş: bölüm o sunucunun sabitini gösterir, kaldırınca bu adrese geçer. */
  blocked?: { pin: TlsPin; url: string } | null;
}

async function saveAddress(url: string): Promise<void> {
  await setStoredApiBaseUrl(url);
  applyApiBaseUrl(url);
}

function useLanTls(api: DiscoveryApi | undefined, { url, recent, onAddressChanged, blocked }: Props) {
  const [pins, setPins] = useState<TlsPin[]>([]);
  const [plan, setPlan] = useState<TlsSwitchPlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!api?.tlsPins) return;
    let alive = true;
    void api.tlsPins().then((p) => alive && setPins(p)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);
  useEffect(() => setPlan(null), [url]);

  const blockedPin = blocked ? (pins.find((p) => p.installationId === blocked.pin.installationId) ?? null) : null;
  const active = blockedPin ?? (url ? activePinFor(pins, url) : null);
  const fallback = blockedPin && blocked ? blocked.url : httpFallbackUrl(url, recent);

  const observe = async () => {
    if (!api || !url) return;
    setBusy(true);
    try {
      setPlan(planTlsSwitch(await api.tlsObserve(url)));
    } catch {
      setPlan({ kind: "unavailable", reason: "Sunucuya ulaşılamadı." });
    } finally {
      setBusy(false);
    }
  };

  const pin = async (fingerprint: string, via: TlsPinVia) => {
    if (!api) return;
    setBusy(true);
    try {
      const res = await api.tlsPin({ baseUrl: url, fingerprint, via });
      if (!res.ok) {
        toast.error("Şifreli bağlantıya geçilemedi.", { description: res.reason });
        return;
      }
      await saveAddress(res.baseUrl);
      await pushRecentApiBaseUrl(res.baseUrl);
      setPins(await api.tlsPins());
      setPlan(null);
      toast.success("Şifreli bağlantıya geçildi.", { description: res.baseUrl });
      onAddressChanged(res.baseUrl);
    } catch {
      toast.error("Şifreli bağlantıya geçilemedi.");
    } finally {
      setBusy(false);
    }
  };

  const unpin = async (): Promise<boolean> => {
    if (!api || !active) return false;
    try {
      await api.tlsUnpin(active.installationId);
      await saveAddress(fallback);
      setPins(await api.tlsPins());
      toast.success("Şifreli bağlantı kaldırıldı.", { description: `Şifresiz adrese dönüldü: ${fallback} — bağlantıyı test edin.` });
      onAddressChanged(fallback);
      return true;
    } catch {
      toast.error("Şifreli bağlantı kaldırılamadı.");
      return false;
    }
  };

  return { active, fallback, plan, busy, observe, pin, unpin };
}

function FingerprintLine({ hex, testId }: { hex: string; testId: string }) {
  return (
    <p className="font-mono text-sm tracking-wide" data-testid={testId}>
      {formatFingerprintGroups(hex)}
    </p>
  );
}

/** Döngü adresinde kod doğrudan alınır; başka her adreste kullanıcı gözle karşılaştırıp onaylar. */
function SwitchPlanView({ plan, busy, onPin }: { plan: TlsSwitchPlan; busy: boolean; onPin: (fp: string, via: TlsPinVia) => void }) {
  const [same, setSame] = useState(false);
  if (plan.kind === "unavailable") return <Callout tone="muted">{plan.reason}</Callout>;
  if (plan.kind === "mismatch") return <Callout tone="danger">{plan.reason}</Callout>;
  if (plan.kind === "loopback") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Bu bilgisayar sunucunun kendisi — kod doğrudan alındı:</p>
        <FingerprintLine hex={plan.fingerprint} testId="lan-tls-observed-fp" />
        <Button type="button" size="sm" onClick={() => onPin(plan.fingerprint, "loopback")} disabled={busy}>
          Şifreli bağlantıya geç
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Aşağıdaki kodu sunucu bilgisayarının kendisinde görünen kodla karşılaştırın (oradaki panel: Sunucu Adresi → Şifreli bağlantı; ya da tarayıcıda http://localhost:4000/ durum sayfası).
        Tek bir harf bile farklıysa onaylamayın.
      </p>
      <FingerprintLine hex={plan.fingerprint} testId="lan-tls-observed-fp" />
      <div className="flex items-center gap-2">
        <Checkbox id="lan-tls-same" checked={same} onCheckedChange={(v) => setSame(v === true)} />
        <Label htmlFor="lan-tls-same" className="text-xs">
          Kodlar birebir aynı
        </Label>
      </div>
      <Button type="button" size="sm" onClick={() => onPin(plan.fingerprint, "confirmed")} disabled={busy || !same}>
        Onayla ve şifreli bağlantıya geç
      </Button>
    </div>
  );
}

/**
 * Şifreli bağlantı (LAN TLS): parmak izini gösterir, kullanıcının gözle karşılaştırma onayıyla
 * ya da sunucu bilgisayarının kendisinde (döngü adresi) sabitler; sabiti açık kararla kaldırır.
 * Onaysız sabitleme yok — keşiften gelen kod güven kaynağı değildir.
 */
export function LanTlsSection(props: Props) {
  const api = typeof window !== "undefined" ? window.api?.discovery : undefined;
  const { active, fallback, plan, busy, observe, pin, unpin } = useLanTls(api, props);
  const [unpinOpen, setUnpinOpen] = useState(false);
  if (!api?.tlsObserve) return null;

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="lan-tls-section">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {active ? <Lock className="h-4 w-4 text-success" /> : <LockOpen className="h-4 w-4 text-muted-foreground" />}
        Şifreli bağlantı {active ? "açık" : "kapalı"}
      </div>
      {active ? (
        <>
          <p className="text-xs text-muted-foreground">
            Bu bilgisayar sunucuyu sertifika koduyla tanıyor. Başka bilgisayar ya da tablet eklerken onların ekranındaki
            kod bununla aynı olmalı:
          </p>
          <FingerprintLine hex={active.fingerprint} testId="lan-tls-active-fp" />
          <Button type="button" variant="ghost" size="sm" onClick={() => setUnpinOpen(true)} disabled={busy}>
            Şifreli bağlantıyı kaldır
          </Button>
        </>
      ) : plan ? (
        <SwitchPlanView key={plan.kind} plan={plan} busy={busy} onPin={(fp, via) => void pin(fp, via)} />
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => void observe()} disabled={busy || !props.url}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          Şifreli bağlantıya geç
        </Button>
      )}
      <ConfirmDialog
        open={unpinOpen}
        onOpenChange={setUnpinOpen}
        title="Şifreli bağlantı kaldırılsın mı?"
        description={`Bu bilgisayar sunucuya yeniden şifresiz (HTTP) bağlanacak: ${fallback}. Yeniden şifreli bağlantıya geçmek için kodu tekrar karşılaştırmanız gerekir.`}
        confirmLabel="Kaldır"
        destructive
        onConfirm={async () => {
          if (await unpin()) setUnpinOpen(false);
        }}
      />
    </div>
  );
}
