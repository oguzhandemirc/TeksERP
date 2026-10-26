import { lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, PenTool } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { DESIGNER_DISABLED_TITLE, designerSettingPath, designerSettingTrail, isDocumentDesignerEnabled } from "./designer-flag";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssignmentsView } from "./assignments/AssignmentsView";
import { TemplateListView } from "./templates/TemplateListView";
import { useNarrowEditor } from "@/hooks/useMediaQuery";
import { WideScreenNotice } from "@/components/layout/WideScreenNotice";
import { useTemplateAccess } from "./templates/useTemplateAccess";

// GrapesJS (~1,1 MB) ayrı parçada: bayrak kapalıyken ya da sayfa açılmadıkça indirilmez (200 KB kuralı).
const DesignerWorkspace = lazy(() => import("./DesignerWorkspace"));

export const DOCUMENT_DESIGNER_TITLE = "Belge Tasarımcısı";
/** Kaydedilmemiş karalama editörü (şablon kimliği yok) — liste ekranı kök yolda. */
export const DESIGNER_SCRATCH_ID = "new";

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Tasarımcı yükleniyor…
    </div>
  );
}

/** Liste yüzü: şablonlar ve atamalar iki sekme (plan §4). */
function ListFace() {
  const access = useTemplateAccess();
  return (
    <Tabs defaultValue="templates" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="self-start">
        <TabsTrigger value="templates">Şablonlar</TabsTrigger>
        <TabsTrigger value="assignments">Atamalar</TabsTrigger>
      </TabsList>
      <TabsContent value="templates" className="min-h-0 flex-1">
        <TemplateListView />
      </TabsContent>
      <TabsContent value="assignments" className="min-h-0 flex-1">
        <AssignmentsView access={access} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * Belge Tasarımcısı (plan §4): kök yol şablon listesi (Sistem satırı, rozetler, sürümler,
 * atamalar); `/:id` editör. Bayrak kapalıyken her iki yüz de çıkışlı boş durum (P-c).
 */
export function DocumentDesignerPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const flagsQuery = useFeatureFlags();
  const enabled = isDocumentDesignerEnabled(flagsQuery.data?.data);
  const isList = !id;
  // GrapesJS tuvali telefonda kullanılamaz — editör yerine uyarı (liste yüzü açık kalır).
  const narrow = useNarrowEditor();

  return (
    <PageShell className="h-full">
      <PageHeader
        title={DOCUMENT_DESIGNER_TITLE}
        description={isList ? "Belge şablonları: Sistem tasarımını kopyalayıp düzenleyin, sürümleri karşılaştırın, yayınlayın ve atayın." : "Belgeyi sürükle-bırak bloklar ve stil paneliyle sayfa üzerinde tasarlayın."}
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
      ) : isList ? (
        <ListFace />
      ) : narrow ? (
        <WideScreenNotice what="Belge tasarımcısı" />
      ) : (
        <Suspense fallback={<Loading />}>
          <DesignerWorkspace templateId={id === DESIGNER_SCRATCH_ID ? null : id} />
        </Suspense>
      )}
    </PageShell>
  );
}
