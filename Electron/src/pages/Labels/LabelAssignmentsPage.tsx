import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InfoPopover } from "@/components/ui/info-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { RefreshButton } from "@/components/RefreshButton";
import {
  labelKindLabels,
  labelTemplateService,
  type LabelKind,
} from "@/services/labelTemplateService";
import { isOptionSetKind } from "@/services/labelTemplateOptionService";
import { ContextDefaultRowItem } from "./ContextDefaultRowItem";
import { GLOBAL_SETS_KEY, GlobalLabelSetsCard, useGlobalLabelSets } from "./GlobalLabelSetsCard";

const DEFAULTS_KEY = "label-context-defaults";
const TEMPLATES_KEY = "label-templates";

/**
 * Atamalar — bağlam (kind) başına varsayılan şablon (LabelContextDefault).
 * Şablonlar TEK HAVUZ; hangi bağlamda hangisinin basılacağı buradan seçilir.
 * Çözüm zinciri: Müşteri > Cihaz > Bağlam varsayılanı > şablonsuz (katalog düzeni).
 * Ham/bitmiş top bağlamları "Herkes için set" kartında (yıldız = varsayılan); uç yoksa
 * (eski backend, 404) o bağlamlar bugünkü tek seçim satırına döner.
 */
export function LabelAssignmentsPage({
  hideHeader,
  actionsPortal,
}: { hideHeader?: boolean; actionsPortal?: HTMLElement | null } = {}) {
  const qc = useQueryClient();

  const defaultsQuery = useQuery({
    queryKey: [DEFAULTS_KEY],
    queryFn: () => labelTemplateService.listContextDefaults(),
  });
  // Atanabilir havuz = serbest etiketler HARİÇ; seçenekler aktiflerden süzülür.
  const templatesQuery = useQuery({
    queryKey: [TEMPLATES_KEY, "assignable"],
    queryFn: () => labelTemplateService.list({ assignable: true }),
  });

  const setMut = useMutation({
    mutationFn: (vars: { kind: LabelKind; templateId: string | null }) =>
      labelTemplateService.setContextDefault(vars.kind, vars.templateId),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.templateId ? "Bağlam varsayılanı güncellendi." : "Varsayılan ataması kaldırıldı.",
      );
      void qc.invalidateQueries({ queryKey: [DEFAULTS_KEY] });
      void qc.invalidateQueries({ queryKey: [TEMPLATES_KEY] });
    },
  });

  // Set PUT'u varsayılanı da yazar → tek seçim satırlarının önbelleği tazelenir.
  const sets = useGlobalLabelSets([[DEFAULTS_KEY]]);
  const setsShown = sets.status !== "missing";

  const actions = <RefreshButton queryKey={DEFAULTS_KEY} extraKeys={[[TEMPLATES_KEY, "assignable"], [GLOBAL_SETS_KEY]]} />;
  const loading = defaultsQuery.isLoading || templatesQuery.isLoading;
  const defaults = defaultsQuery.data ?? [];
  const activeTemplates = (templatesQuery.data?.data ?? []).filter((t) => t.isActive);

  return (
    <PageShell>
      {!hideHeader && <PageHeader title="Etiket Atamaları" actions={actions} />}
      <PageBody className="p-4">
        {hideHeader && !actionsPortal && (
          <div className="mb-3 flex items-center justify-end gap-2">{actions}</div>
        )}
        {hideHeader && actionsPortal && createPortal(actions, actionsPortal)}

        {/* B6: iki sütun (bağlam varsayılanları | top etiketi seti + öncelik notu); açıklamalar ⓘ'de. */}
        <div className="grid w-full items-start gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Bağlam Varsayılanları
                <InfoPopover
                  label="Bağlam varsayılanları"
                  desc="Her bağlam için havuzdan bir varsayılan şablon seçin. Müşteriye veya cihaza özel atama yoksa baskı bu şablonla yapılır; varsayılan yoksa şablonsuz (katalog düzeni) basılır."
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <ul className="divide-y">
                  {(Object.keys(labelKindLabels) as LabelKind[])
                    .filter((kind) => !(setsShown && isOptionSetKind(kind)))
                    .map((kind) => (
                      <ContextDefaultRowItem
                        key={kind}
                        kind={kind}
                        assigned={defaults.find((d) => d.kind === kind)}
                        activeTemplates={activeTemplates}
                        pending={setMut.isPending && setMut.variables?.kind === kind}
                        onChange={(templateId) => setMut.mutate({ kind, templateId })}
                      />
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <GlobalLabelSetsCard sets={sets} />
            <CustomerPriorityNote />
          </div>
        </div>
      </PageBody>
    </PageShell>
  );
}

function CustomerPriorityNote() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Müşteriye Özel Şablon</CardTitle>
      </CardHeader>
      <CardContent>
        <Callout tone="info" title={"Öncelik zinciri: Müşteri > Cihaz > Varsayılan"}>
          Baskı anında şablon önce müşteri atamasından, yoksa cihaz yönlendirmesinden,
          o da yoksa buradaki bağlam varsayılanından çözülür. Müşteriye özel şablon
          atamaları <strong>Müşteriler</strong> sayfasındaki müşteri formundan yapılır.
        </Callout>
      </CardContent>
    </Card>
  );
}
