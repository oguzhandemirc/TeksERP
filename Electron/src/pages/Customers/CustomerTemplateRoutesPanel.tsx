import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionGate } from "@/components/PermissionGate";
import { InfoPopover } from "@/components/ui/info-popover";
import {
  customerTemplateRouteService,
  labelTemplateService,
  labelKindLabels,
  type CustomerTemplateRouteRow,
  type LabelKind,
  type LabelTemplateListRow,
} from "@/services/labelTemplateService";
import { isOptionSetKind } from "@/services/labelTemplateOptionService";
import { CustomerLabelSetsSection, useCustomerLabelSets } from "./CustomerLabelSetsSection";

interface Props {
  customerId: string;
}

/** Panel sırası: Ham → Bitmiş → Kartela. Top etiketinin türü topun AŞAMASINDAN türer (2026-11-10), istasyondan/renkten değil. */
const KINDS: LabelKind[] = ["ROLL_RAW", "ROLL_FINISHED", "SWATCH", "SACK"];

/**
 * Müşteriye özel etiket şablonu atamaları (CustomerTemplateRoute).
 * Çözüm zinciri: explicit > MÜŞTERİ > cihaz > bağlam varsayılanı — buradaki
 * atama, cihaz yönlendirmesinin ve genel varsayılanın önüne geçer.
 * Ham/bitmiş top bağlamları çoklu sette (yıldız = bu tablodaki atama); set uçları
 * yoksa (eski backend, 404) bugünkü tek seçim satırına dönülür.
 */
export function CustomerTemplateRoutesPanel({ customerId }: Props) {
  const qc = useQueryClient();
  const routesKey = ["customer-template-routes", customerId];

  const routesQuery = useQuery({
    queryKey: routesKey,
    queryFn: () => customerTemplateRouteService.list(customerId),
  });

  // Atanabilir havuz — serbest etiketler atama seçicisinde GÖRÜNMEZ. Ayrı key
  // (unwrap edilmiş dizi döner; ApiResponse dönen "assignable" key'iyle çakışmaz).
  const templatesQuery = useQuery({
    queryKey: ["label-templates", "assignable", "route-picker"],
    queryFn: () => labelTemplateService.list({ assignable: true }).then((r) => r.data),
  });

  const setMut = useMutation({
    mutationFn: ({ kind, templateId }: { kind: LabelKind; templateId: string | null }) =>
      customerTemplateRouteService.set(customerId, kind, templateId),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.templateId
          ? "Müşteriye özel etiket şablonu atandı."
          : "Müşteriye özel şablon ataması kaldırıldı.",
      );
      qc.invalidateQueries({ queryKey: routesKey });
    },
  });

  // Set PUT'u yıldızı CustomerTemplateRoute'a yazar → tek seçim önbelleği tazelenir.
  const sets = useCustomerLabelSets(customerId, [routesKey]);
  const setsShown = sets.status !== "missing";

  if (routesQuery.isLoading || templatesQuery.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  const routes = routesQuery.data ?? [];
  const activeTemplates = (templatesQuery.data ?? []).filter((t) => t.isActive);

  return (
    <div className="space-y-3">
      {/* Açıklama sekme kartının ⓘ balonunda (CustomerLabelTemplatesTab). */}
      <CustomerLabelSetsSection sets={sets} />

      <ul className="grid gap-x-6 gap-y-2 lg:grid-cols-2">
        {KINDS.filter((kind) => !(setsShown && isOptionSetKind(kind))).map((kind) => (
          <RouteRow
            key={kind}
            kind={kind}
            route={routes.find((r) => r.kind === kind) ?? null}
            activeTemplates={activeTemplates}
            isPending={setMut.isPending}
            onSet={(templateId) => setMut.mutate({ kind, templateId })}
          />
        ))}
      </ul>
    </div>
  );
}

function RouteRow({
  kind,
  route,
  activeTemplates,
  isPending,
  onSet,
}: {
  kind: LabelKind;
  route: CustomerTemplateRouteRow | null;
  activeTemplates: LabelTemplateListRow[];
  isPending: boolean;
  onSet: (templateId: string | null) => void;
}) {
  // Atanan şablon pasifse aktif havuzda görünmez — mevcut değerin Select'te
  // kaybolmaması için "(pasif)" işaretiyle listeye eklenir.
  const assignedInactive = route && !route.templateActive;
  const missingFromPool =
    route && !activeTemplates.some((t) => t.id === route.templateId);

  return (
    <li className="space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <span className="flex w-36 shrink-0 items-center gap-1 font-medium">
          {labelKindLabels[kind]}
          {kind === "SWATCH" && <InfoPopover label="Kartela etiketi: not" desc="Kartela etiketi baskısında müşteri ataması henüz uygulanmaz." />}
        </span>

        <PermissionGate
          permission="label-template:write"
          fallback={
            <span className={route ? "" : "text-muted-foreground"}>
              {route ? route.templateName : "Genel varsayılan"}
            </span>
          }
        >
          <div className="min-w-0 flex-1">
            <Select
              value={route?.templateId ?? ""}
              onValueChange={(v) => onSet(v)}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="Genel varsayılan" />
              </SelectTrigger>
              <SelectContent>
                {route && missingFromPool && (
                  <SelectItem value={route.templateId}>
                    {route.templateName} (pasif)
                  </SelectItem>
                )}
                {activeTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {route && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1 text-muted-foreground"
              disabled={isPending}
              onClick={() => onSet(null)}
            >
              <X className="h-3.5 w-3.5" /> Kaldır
            </Button>
          )}
        </PermissionGate>
      </div>

      {/* Boşken seçici "Genel varsayılan" yazar; yalnız kritik olan (pasif atama) açıkta kalır. */}
      {assignedInactive && (
        <p className="pl-[9.5rem] text-xs text-amber-600 dark:text-amber-500">
          Atanan şablon pasif — baskıda varsayılana düşülür.
        </p>
      )}
    </li>
  );
}
