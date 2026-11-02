// =============================================================================
// KALİTE GÜVENCE › LAB TESTLERİ (K4P-LAB)
// =============================================================================
// Top ya da parti numunesinin lab sonuçları: taslak → onay (donar) → gerektiğinde gerekçeli iptal.
// Modül kapalıyken backend 403 MODULE_DISABLED verir; route kapısı `route-modules.ts` eşlemesinden.
// =============================================================================
import { useState } from "react";
import { Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListToolbar } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionGate } from "@/components/PermissionGate";
import { LabTestList } from "./LabTestList";
import { LabTypesPanel } from "./LabTypesPanel";
import { NewLabTestDialog } from "./NewLabTestDialog";
import { LabTestDetailDialog } from "./LabTestDetailDialog";
import { RefreshButton } from "@/components/RefreshButton";

const TAB_PANE = "mt-0 flex min-h-0 flex-1 flex-col";

export function LabTestsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <PageShell>
      <PageHeader
        title="Lab Testleri"
        description="Numune sonuçları (gramaj, haslık, çekme…) — onaylanan test donar, iptal gerekçeyle saklanır."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["lab-tests"]} extraKeys={[["lab-test-types"]]} />
            <PermissionGate permission="labtest:write">
              <Button onClick={() => setFormOpen(true)}><Plus className="mr-1 h-4 w-4" />Yeni Test</Button>
            </PermissionGate>
          </div>
        }
      />
      <Tabs defaultValue="tests" className="flex min-h-0 flex-1 flex-col">
        <ListToolbar>
          <TabsList className="self-start">
            <TabsTrigger value="tests">Testler</TabsTrigger>
            <TabsTrigger value="types">Test türleri</TabsTrigger>
          </TabsList>
        </ListToolbar>
        <TabsContent value="tests" className={TAB_PANE}><LabTestList onOpen={setOpenId} /></TabsContent>
        <TabsContent value="types" className={TAB_PANE}><LabTypesPanel /></TabsContent>
      </Tabs>
      {formOpen && <NewLabTestDialog open onOpenChange={setFormOpen} onCreated={setOpenId} />}
      {openId && <LabTestDetailDialog testId={openId} onClose={() => setOpenId(null)} />}
    </PageShell>
  );
}
