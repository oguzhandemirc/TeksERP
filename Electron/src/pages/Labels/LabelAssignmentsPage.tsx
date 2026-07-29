import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { RefreshButton } from "@/components/RefreshButton";
import {
  labelKindLabels,
  labelTemplateService,
  type LabelKind,
} from "@/services/labelTemplateService";
import { ContextDefaultRowItem } from "./ContextDefaultRowItem";

const DEFAULTS_KEY = "label-context-defaults";
const TEMPLATES_KEY = "label-templates";

/**
 * Atamalar — bağlam (kind) başına varsayılan şablon (LabelContextDefault).
 * Şablonlar TEK HAVUZ; hangi bağlamda hangisinin basılacağı buradan seçilir.
 * Çözüm zinciri: Müşteri > Cihaz > Bağlam varsayılanı > şablonsuz (katalog düzeni).
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

  const actions = (
    <RefreshButton queryKey={DEFAULTS_KEY} extraKeys={[[TEMPLATES_KEY, "assignable"]]} />
  );
  const loading = defaultsQuery.isLoading || templatesQuery.isLoading;
  const defaults = defaultsQuery.data ?? [];
  const activeTemplates = (templatesQuery.data?.data ?? []).filter((t) => t.isActive);

  return (
    <PageShell>
      {!hideHeader && (
        <PageHeader
          title="Etiket Atamaları"
          actions={actions}
        />
      )}
      <PageBody className="p-4">
        {hideHeader && !actionsPortal && (
          <div className="mb-3 flex items-center justify-end gap-2">{actions}</div>
        )}
        {hideHeader && actionsPortal && createPortal(actions, actionsPortal)}

        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Bağlam Varsayılanları</CardTitle>
              <CardDescription>
                Her bağlam için havuzdan bir varsayılan şablon seçin. Müşteriye veya cihaza
                özel atama yoksa baskı bu şablonla yapılır.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <ul className="divide-y">
                  {(Object.keys(labelKindLabels) as LabelKind[]).map((kind) => (
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
        </div>
      </PageBody>
    </PageShell>
  );
}
