import { useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";
import type { UpdateStatus } from "@shared/ipc-contract";
import { ALLOWED_UPDATE_HOST, GROUP_UNKNOWN_TEXT, validateFeedOverride } from "@shared/update-feed";
import { useUpdater } from "@/hooks/useUpdater";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";
import { useClientPolicy } from "@/hooks/useClientPolicy";
import { isBelowMinimum } from "@/lib/version-compare";
import { factoryDateTimeFormat } from "@/lib/factory-time";

const dtFmt = () => factoryDateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Durumun operatöre görünen tek cümlelik karşılığı. */
function describe(s: UpdateStatus): {
  text: string;
  tone: "info" | "success" | "warning" | "danger" | "muted";
} {
  if (!s.enabled) {
    return { text: "Geliştirme modunda çalışıyor — otomatik güncelleme kapalı.", tone: "muted" };
  }
  // Ortak paket: grup kiradan gelmedi → denetim yapılmadı (hata değil, bekleyen ön koşul).
  if (s.grup === null && s.state === "idle") return { text: GROUP_UNKNOWN_TEXT, tone: "muted" };
  switch (s.state) {
    case "checking":
      return { text: "Kontrol ediliyor…", tone: "muted" };
    case "up-to-date":
      return { text: "En güncel sürüm kurulu.", tone: "success" };
    case "available":
      return { text: `Yeni sürüm bulundu (${s.newVersion ?? "?"}) — indiriliyor.`, tone: "info" };
    case "downloading":
      return { text: `İndiriliyor… %${s.percent ?? 0}`, tone: "info" };
    case "ready":
      return {
        text: `Yeni sürüm (${s.newVersion ?? "?"}) indirildi — yeniden başlatınca kurulacak.`,
        tone: "info",
      };
    case "error":
      // İmza reddi ağ hatası değildir: kurulmayan güncellemenin güvenlik uyarısı (kod teşhis içindir).
      return s.imzaReddi
        ? {
            text: `${s.error ?? "Güncelleme güvenlik denetiminden geçemedi; kurulmadı."} (${s.imzaReddi.kod})`,
            tone: "danger",
          }
        : { text: s.error ?? "Güncelleme kontrolü başarısız oldu.", tone: "warning" };
    default:
      return { text: "Henüz kontrol edilmedi.", tone: "muted" };
  }
}

/**
 * "Bu Bilgisayar → Güncelleme" — bu makinedeki sürüm ve güncelleme durumu.
 *
 * Şerit yalnız güncelleme HAZIR olduğunda çıkar; buraya bakan kişi geri kalan
 * her şeyi (son kontrol ne zamandı, adres neresi, hata neydi) görür. Adres
 * kutusu bilerek burada: yayın adresi pakete derleme anında gömülür, yanlış
 * gömülürse tek çıkış yolu makineyi elle gezmek olurdu.
 */
export function UpdateSection() {
  const { status, check, install, setFeedUrl } = useUpdater();
  const policy = useClientPolicy();
  // Adres ezmesi YALNIZ `admin:settings`: ekran donanım personeline (`settings:workstation`) de açıktır, ama
  // güncellemenin nereden indirileceğini değiştirmek onun işi değil. Asıl kural ana süreçte (https + izinli ana
  // makine + `/<kanal>/electron/`); bu kapı arayüz kapısıdır.
  const canEditFeed = useRoleAccess().hasPermission(SETTINGS_ADMIN_PERMISSION);
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!status) {
    return (
      <p className="text-sm text-muted-foreground">
        Güncelleme bilgisi okunamadı (uygulama masaüstü sürümü değil).
      </p>
    );
  }

  const desc = describe(status);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await check();
    } finally {
      setChecking(false);
    }
  };

  const handleSaveUrl = async () => {
    const next = draft.trim();
    const v = next ? validateFeedOverride(next) : null;
    if (v && !v.ok) {
      toast.error(v.reason);
      return;
    }
    try {
      await setFeedUrl(v ? v.url : null);
    } catch {
      toast.error("Güncelleme adresi kabul edilmedi (yalnız izinli https adresi).");
      return;
    }
    setEditing(false);
    toast.success(next ? "Güncelleme adresi bu bilgisayar için değiştirildi" : "Varsayılan adrese dönüldü");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 text-sm">
          <div>
            Kurulu sürüm: <span className="font-mono font-semibold">{status.currentVersion}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {status.lastCheckedAt
              ? `Son kontrol: ${dtFmt().format(new Date(status.lastCheckedAt))}`
              : "Henüz kontrol edilmedi"}
          </p>
          {policy && (
            <p
              className={`text-xs ${
                isBelowMinimum(status.currentVersion, policy.minVersion)
                  ? "font-medium text-warning"
                  : "text-muted-foreground"
              }`}
            >
              Sunucu en az <span className="font-mono">{policy.minVersion}</span> istiyor
              {isBelowMinimum(status.currentVersion, policy.minVersion)
                ? " — bu sürüm desteklenmiyor"
                : " ✓"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!status.enabled || checking || status.state === "downloading"}
            onClick={handleCheck}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
            Şimdi kontrol et
          </Button>
          {status.state === "ready" && (
            <Button size="sm" className="gap-1.5" onClick={install}>
              <Download className="h-3.5 w-3.5" />
              Kur ve yeniden başlat
            </Button>
          )}
        </div>
      </div>

      <Callout tone={desc.tone}>
        <span className="text-xs">{desc.text}</span>
      </Callout>

      <div className="space-y-2 border-t border-border/50 pt-3">
        <div className="text-xs font-medium text-muted-foreground">Güncelleme adresi</div>
        {editing && canEditFeed ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`https://${ALLOWED_UPDATE_HOST}/<grup>/electron/`}
              className="h-8 min-w-[280px] flex-1 font-mono text-xs"
            />
            <Button size="sm" onClick={handleSaveUrl}>
              Kaydet
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Vazgeç
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <div className="truncate font-mono text-xs">{status.feedUrl || "—"}</div>
              <p className="text-[11px] text-muted-foreground">
                {status.feedUrlOverridden
                  ? "Bu bilgisayara özel adres (varsayılan değil)."
                  : "Varsayılan adres — lisanstaki güncelleme grubundan."}
              </p>
              <p className="text-[11px] text-muted-foreground" data-guncelleme-grubu="">
                Güncelleme grubu: <span className="font-mono">{status.grup ?? "bilinmiyor"}</span>
              </p>
            </div>
            {canEditFeed && (
              <div className="flex items-center gap-2">
                {status.feedUrlOverridden && (
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void setFeedUrl(null)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Varsayılana dön
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft(status.feedUrlOverridden ? status.feedUrl : "");
                    setEditing(true);
                  }}
                >
                  Değiştir
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
