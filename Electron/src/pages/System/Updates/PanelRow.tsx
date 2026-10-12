import { useState } from "react";
import { Monitor, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdater } from "@/hooks/useUpdater";
import { useGuardedInstall } from "@/hooks/useGuardedInstall";
import { panelRowState } from "@/lib/updater-durum";
import { RELEASE_NOTES_PATH } from "@/pages/ReleaseNotes/release-notes-path";
import { useSurumNotuStore } from "@/store/surum-notu";
import { useTabsStore } from "@/store/tabs";
import { UpdateRow } from "./UpdateRow";

/** "Neler yeni?" — masaüstünde sürüm notu penceresi; tarayıcıda (kurulu sürüm yok) Sürüm Notları sayfası. */
function WhatsNew({ desktop }: { desktop: boolean }) {
  const open = useSurumNotuStore((s) => s.ac);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  return (
    <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => (desktop ? open(true) : navigateActive(RELEASE_NOTES_PATH))}>
      Neler yeni?
    </button>
  );
}

/** "Bu bilgisayar" satırı — bu makinedeki panel (electron-updater); durum cümlesi tek kaynaktan (`panelRowState`). */
export function PanelRow() {
  const { status, check, install } = useUpdater();
  const [checking, setChecking] = useState(false);
  // Açık form varsa önce uyarır — güncelleme kapısıyla aynı kayıt.
  const { request: requestInstall, confirmDialog } = useGuardedInstall(install);
  if (!status) {
    return (
      <UpdateRow
        id="panel"
        icon={Monitor}
        title="Bu bilgisayar"
        version={null}
        status={{ label: "Tarayıcıda açılan panel her yenilemede en güncel sürümü yükler", tone: "muted" }}
        footer={<WhatsNew desktop={false} />}
      />
    );
  }
  const row = panelRowState(status);
  const runCheck = async () => {
    setChecking(true);
    try {
      await check();
    } finally {
      setChecking(false);
    }
  };
  const busy = checking || status.state === "checking" || status.state === "downloading";
  const checkButton = (
    <Button size="sm" variant="outline" className="gap-1.5" disabled={!status.enabled || busy} onClick={() => void runCheck()}>
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      {row.sorun ? "Yeniden dene" : "Denetle"}
    </Button>
  );
  return (
    <UpdateRow
      id="panel"
      icon={Monitor}
      title="Bu bilgisayar"
      version={status.currentVersion}
      status={{ label: row.sorun ? "Sorun" : row.metin, tone: row.ton }}
      actions={
        row.kurulabilir ? (
          <>
            <Button size="sm" title="Yeni sürümü kurar ve paneli yeniden başlatır" onClick={requestInstall}>
              Yeniden başlat
            </Button>
            {confirmDialog}
          </>
        ) : row.sorun ? undefined : (
          checkButton
        )
      }
      problem={row.sorun ? { text: row.metin, tone: row.ton, action: checkButton } : null}
      footer={<WhatsNew desktop />}
    />
  );
}
