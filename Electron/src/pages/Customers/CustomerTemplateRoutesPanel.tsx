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
import {
  customerTemplateRouteService,
  labelTemplateService,
  labelKindLabels,
  type CustomerTemplateRouteRow,
  type LabelKind,
  type LabelTemplateListRow,
} from "@/services/labelTemplateService";

interface Props {
  customerId: string;
}

/** Panel sırası: Ham → Bitmiş → Kartela. */
const KINDS: LabelKind[] = ["ROLL_RAW", "ROLL_FINISHED", "SWATCH", "SACK"];

/**
 * Müşteriye özel etiket şablonu atamaları (CustomerTemplateRoute).
 * Çözüm zinciri: explicit > MÜŞTERİ > cihaz > bağlam varsayılanı — buradaki
 * atama, cihaz yönlendirmesinin ve genel varsayılanın önüne geçer.
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

  if (routesQuery.isLoading || templatesQuery.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  const routes = routesQuery.data ?? [];
  const activeTemplates = (templatesQuery.data ?? []).filter((t) => t.isActive);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Bu müşteri için basılan etiketlerde kullanılacak şablonlar. Atama; cihaz
        yönlendirmesinin ve genel varsayılanın önüne geçer. Boş bırakılan bağlamda
        genel varsayılan kullanılır.
      </p>

      <ul className="divide-y rounded-md border">
        {KINDS.map((kind) => (
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
    <li className="space-y-1.5 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-44 shrink-0 font-medium">{labelKindLabels[kind]}</span>

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
                <SelectValue placeholder="Şablon seç..." />
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

      {!route && (
        <p className="pl-44 text-xs text-muted-foreground">
          Genel varsayılan kullanılır.
        </p>
      )}
      {assignedInactive && (
        <p className="pl-44 text-xs text-amber-600 dark:text-amber-500">
          Atanan şablon pasif — baskıda varsayılana düşülür.
        </p>
      )}
      {kind === "SWATCH" && (
        <p className="pl-44 text-xs text-muted-foreground">
          Kartela etiketi baskısında müşteri ataması henüz uygulanmaz.
        </p>
      )}
    </li>
  );
}
