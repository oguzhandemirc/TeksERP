// =============================================================================
// KALİTE GÜVENCE › LAB TESTLERİ (K4P-LAB)
// =============================================================================
// Top ya da parti numunesinin lab sonuçları: taslak → onay (donar) → gerektiğinde gerekçeli iptal.
// Modül kapalıyken backend 403 MODULE_DISABLED verir; route kapısı `route-modules.ts` eşlemesinden.
// =============================================================================
import { useState } from "react";
import { Plus } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionGate } from "@/components/PermissionGate";
import { LabTestList } from "./LabTestList";
import { LabTypesPanel } from "./LabTypesPanel";
import { NewLabTestDialog } from "./NewLabTestDialog";
import { LabTestDetailDialog } from "./LabTestDetailDialog";

export function LabTestsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <PageShell>
      <PageHeader
        title="Lab Testleri"
        description="Numune sonuçları (gramaj, haslık, çekme…) — onaylanan test donar, iptal gerekçeyle saklanır."
        actions={
          <PermissionGate permission="labtest:write">
            <Button onClick={() => setFormOpen(true)}><Plus className="mr-1 h-4 w-4" />Yeni Test</Button>
          </PermissionGate>
        }
      />
      <PageBody className="p-4 sm:p-6">
        <Tabs defaultValue="tests">
          <TabsList>
            <TabsTrigger value="tests">Testler</TabsTrigger>
            <TabsTrigger value="types">Test türleri</TabsTrigger>
          </TabsList>
          <TabsContent value="tests" className="mt-4"><LabTestList onOpen={setOpenId} /></TabsContent>
          <TabsContent value="types" className="mt-4"><LabTypesPanel /></TabsContent>
        </Tabs>
      </PageBody>
      {formOpen && <NewLabTestDialog open onOpenChange={setFormOpen} onCreated={setOpenId} />}
      {openId && <LabTestDetailDialog testId={openId} onClose={() => setOpenId(null)} />}
    </PageShell>
  );
}
