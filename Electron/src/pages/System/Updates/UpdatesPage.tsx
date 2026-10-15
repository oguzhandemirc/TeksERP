import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { lastUpdateText } from "../ServerUpdates/serverRow";
import { SERVER_UPDATE_KEY, SERVER_UPDATE_SUMMARY_KEY } from "../ServerUpdates/hooks";
import { PanelRow } from "./PanelRow";
import { IS_ELECTRON } from "@/lib/runtime-env";
import { ServerRow } from "./ServerRow";
import { UpdateDetails } from "./UpdateDetails";
import { useServerUpdateView } from "./useServerUpdateView";

/**
 * GÜNCELLEMELER — sunucu ve bu bilgisayar için TEK yer (kullanıcı kararı 2026-10-12). Herkes açar; onay düğmeleri
 * yalnız `license:manage`e. Tabletler burada yok. Teknik ayrıntılar kapalı "Ayrıntılar" bölümünde.
 */
export function UpdatesPage() {
  const v = useServerUpdateView();
  return (
    <PageShell>
      <PageHeader title="Güncellemeler" actions={<RefreshButton queryKey={[...SERVER_UPDATE_KEY]} extraKeys={[[...SERVER_UPDATE_SUMMARY_KEY]]} />} />
      <PageBody className="max-w-4xl space-y-4 p-6">
        <ServerRow v={v} />
        {/* Web paneli güncelleyici taşımaz — "bu bilgisayar" satırı yalnız masaüstünde. */}
        {IS_ELECTRON && <PanelRow />}
        {v.summary && (
          <p data-testid="son-guncelleme" className="text-xs text-muted-foreground">
            {lastUpdateText(v.summary.son)}
          </p>
        )}
        <UpdateDetails full={v.full} canManage={v.canManage} />
      </PageBody>
    </PageShell>
  );
}
