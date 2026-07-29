import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { DashboardHero } from "./DashboardHero";
import { KpiCards } from "./KpiCards";
import { StationLoad } from "./StationLoad";
import { UpcomingOrders } from "./UpcomingOrders";
import { OverdueWorkOrders } from "./OverdueWorkOrders";
import { UpcomingWorkOrders } from "./UpcomingWorkOrders";
import { DashboardSettingsDialog } from "./DashboardSettingsDialog";
import { useDashboardLayout } from "./useDashboardLayout";
import type { GroupKey } from "./widgetRegistry";

const PANEL_RENDERERS: Record<string, ReactNode> = {
  "panel:upcomingOrders": <UpcomingOrders />,
  "panel:overdueWorkOrders": <OverdueWorkOrders />,
  "panel:upcomingWorkOrders": <UpcomingWorkOrders />,
};

export function DashboardPage() {
  const { isVisible, groupOrder, itemOrder } = useDashboardLayout();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const renderGroup = (key: GroupKey): ReactNode => {
    switch (key) {
      case "kpi":
        return <KpiCards />;
      case "stationLoad":
        return isVisible("panel:stationLoad") ? <StationLoad /> : null;
      case "panels": {
        const visible = itemOrder("panels")
          .filter((k) => isVisible(k) && PANEL_RENDERERS[k]);
        if (visible.length === 0) return null;
        return (
          <div className="grid gap-6 lg:grid-cols-2">
            {visible.map((k) => (
              <div key={k}>{PANEL_RENDERERS[k]}</div>
            ))}
          </div>
        );
      }
    }
  };

  return (
    <PageShell>
      <PageBody className="space-y-6 p-6">
      <DashboardHero
        actions={
          <>
            <RefreshButton queryKey="dashboard" successMessage="Anasayfa yenilendi" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              className="gap-2"
            >
              <Settings className="h-4 w-4" />
              Düzenle
            </Button>
          </>
        }
      />
      {groupOrder.map((g) => {
        const node = renderGroup(g);
        if (!node) return null;
        return <Fragment key={g}>{node}</Fragment>;
      })}

      <DashboardSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </PageBody>
    </PageShell>
  );
}
