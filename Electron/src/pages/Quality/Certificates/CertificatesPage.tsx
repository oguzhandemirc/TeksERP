// =============================================================================
// KALİTE GÜVENCE › SERTİFİKALAR (K4P-SERT)
// =============================================================================
// Fabrikanın ve iş ortaklarının sertifikaları (OEKO-TEX, GOTS…) + bitiş takibi; müşteri lab
// spesifikasyonları ikinci sekmede. `?focus=<id>` (bildirim derin bağlantısı) ayrıntıyı açar.
// =============================================================================
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { CertificateList } from "./CertificateList";
import { CertificateDetailDialog } from "./CertificateDetailDialog";
import { CertificateFormDialog, type CertificateFormMode } from "./CertificateFormDialog";
import { CertificateRevokeDialog } from "./CertificateRevokeDialog";
import { CustomerSpecsPanel } from "./CustomerSpecsPanel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function CertificatesPage() {
  const [params, setParams] = useSearchParams();
  const { hasPermission } = useRoleAccess();
  const focus = params.get("focus");
  const [openId, setOpenIdState] = useState<string | null>(focus && UUID.test(focus) ? focus : null);
  const [form, setForm] = useState<CertificateFormMode | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const tab = params.get("tab") === "specs" && hasPermission("labtest:read") ? "specs" : "certificates";
  const setOpenId = (id: string | null) => {
    setOpenIdState(id);
    // Kapanınca odak parametresi düşer; yenilemede dialog yeniden açılmaz.
    if (!id && params.has("focus")) { const p = new URLSearchParams(params); p.delete("focus"); setParams(p, { replace: true }); }
  };
  return (
    <PageShell>
      <PageHeader
        title="Sertifikalar"
        description="OEKO-TEX, GOTS gibi sertifikalar ve bitiş tarihleri — süresi yaklaşınca Bildirimler'de uyarı açılır."
        actions={
          tab === "certificates" && (
            <PermissionGate permission="certificate:write">
              <Button onClick={() => setForm({ kind: "create" })}><Plus className="mr-1 h-4 w-4" />Yeni Sertifika</Button>
            </PermissionGate>
          )
        }
      />
      <PageBody className="p-4 sm:p-6">
        <Tabs value={tab} onValueChange={(v) => { const p = new URLSearchParams(params); if (v === "specs") p.set("tab", "specs"); else p.delete("tab"); setParams(p, { replace: true }); }}>
          <TabsList>
            <TabsTrigger value="certificates">Sertifikalar</TabsTrigger>
            {hasPermission("labtest:read") && <TabsTrigger value="specs">Müşteri spesifikasyonları</TabsTrigger>}
          </TabsList>
          <TabsContent value="certificates" className="mt-4"><CertificateList onOpen={setOpenId} /></TabsContent>
          {hasPermission("labtest:read") && <TabsContent value="specs" className="mt-4"><CustomerSpecsPanel /></TabsContent>}
        </Tabs>
      </PageBody>
      {openId && (
        <CertificateDetailDialog certificateId={openId} soonDays={30} onClose={() => setOpenId(null)}
          onEdit={(c) => setForm({ kind: "edit", cert: c })} onRenew={(c) => setForm({ kind: "renew", cert: c })} onRevoke={setRevokeId} />
      )}
      {form && <CertificateFormDialog mode={form} onOpenChange={(v) => !v && setForm(null)} onSaved={(id) => setOpenId(id)} />}
      {revokeId && <CertificateRevokeDialog certificateId={revokeId} onOpenChange={(v) => !v && setRevokeId(null)} onDone={() => setOpenId(null)} />}
    </PageShell>
  );
}
