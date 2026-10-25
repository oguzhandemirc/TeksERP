import { lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, PenTool } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { DESIGNER_DISABLED_TITLE, designerSettingPath, designerSettingTrail, isDocumentDesignerEnabled } from "./designer-flag";

// GrapesJS (~1,1 MB) ayrı parçada: bayrak kapalıyken ya da sayfa açılmadıkça indirilmez (200 KB kuralı).
const DesignerWorkspace = lazy(() => import("./DesignerWorkspace"));

export const DOCUMENT_DESIGNER_TITLE = "Belge Tasarımcısı";

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Tasarımcı yükleniyor…
    </div>
  );
}

/**
 * Belge Tasarımcısı (plan §4) — sürükle-bırak + stil paneliyle belge
 * şablonu tasarımı. T2 iskeleti: kanvas, bloklar, stil, katmanlar; kayıt,
 * önizleme ve sürümler sonraki dilimlerde.
 */
export function DocumentDesignerPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const flagsQuery = useFeatureFlags();
  const enabled = isDocumentDesignerEnabled(flagsQuery.data?.data);

  return (
    <PageShell className="h-full">
      <PageHeader
        title={DOCUMENT_DESIGNER_TITLE}
        description="Belgeyi sürükle-bırak bloklar ve stil paneliyle sayfa üzerinde tasarlayın."
      />
      {flagsQuery.isLoading ? (
        <Loading />
      ) : !enabled ? (
        <EmptyState
          icon={PenTool}
          title={DESIGNER_DISABLED_TITLE}
          description={`Bu kurulumda tasarımcı açık değil. Açma yetkisi olan kullanıcı ${designerSettingTrail()} ekranından açar.`}
          action={
            <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate(designerSettingPath())}>
              Ayarlardan aç
            </Button>
          }
        />
      ) : (
        <Suspense fallback={<Loading />}>
          <DesignerWorkspace templateId={id ?? null} />
        </Suspense>
      )}
    </PageShell>
  );
}
