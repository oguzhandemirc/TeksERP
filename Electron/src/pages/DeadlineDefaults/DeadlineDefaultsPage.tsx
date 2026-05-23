import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/PermissionGate";
import {
  systemSettingService,
  SETTING_KEYS,
} from "@/services/systemSettingService";

const QUERY_KEY = "system-settings";
const DEFAULT_VALUE = 7;

function parseSetting(value: string | undefined): number {
  if (!value) return DEFAULT_VALUE;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_VALUE;
  return n;
}

export function DeadlineDefaultsPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: systemSettingService.list,
    staleTime: 60_000,
  });

  const settings = query.data?.data ?? [];
  const orderSaved = parseSetting(
    settings.find((s) => s.key === SETTING_KEYS.ORDER_DEFAULT_DEADLINE_DAYS)?.value,
  );
  const woSaved = parseSetting(
    settings.find(
      (s) => s.key === SETTING_KEYS.WORKORDER_DEFAULT_PLAN_DURATION_DAYS,
    )?.value,
  );

  const [orderDraft, setOrderDraft] = useState(orderSaved);
  const [woDraft, setWoDraft] = useState(woSaved);

  useEffect(() => setOrderDraft(orderSaved), [orderSaved]);
  useEffect(() => setWoDraft(woSaved), [woSaved]);

  const dirty = orderDraft !== orderSaved || woDraft !== woSaved;

  const mut = useMutation({
    mutationFn: async () => {
      if (orderDraft !== orderSaved) {
        await systemSettingService.upsert(
          SETTING_KEYS.ORDER_DEFAULT_DEADLINE_DAYS,
          String(orderDraft),
          "Sipariş termini varsayılan gün sayısı (boş bırakılırsa kullanılır)",
        );
      }
      if (woDraft !== woSaved) {
        await systemSettingService.upsert(
          SETTING_KEYS.WORKORDER_DEFAULT_PLAN_DURATION_DAYS,
          String(woDraft),
          "İş emri planlama süresi varsayılan gün sayısı",
        );
      }
    },
    onSuccess: () => {
      toast.success("Varsayılan termin değerleri güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Termin Varsayılanları"
        description="Sipariş ve iş emri açılışında termin alanı boş bırakılırsa kullanılacak gün sayıları."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-4 p-6">
          <Card>
            <CardContent className="flex gap-4 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div className="space-y-1.5 text-sm">
                <p className="font-medium">Termin varsayılanı ne işe yarar?</p>
                <p className="text-muted-foreground">
                  Sipariş veya iş emri açılırken termin alanı boş bırakılırsa, bu sayılar otomatik olarak başlangıç tarihine eklenir.
                </p>
                <div className="mt-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Örnek:</span> Sipariş tarihi 23.05.2026, sipariş termini 7 gün → otomatik termin <span className="font-medium text-foreground">30.05.2026</span>.
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <div className="text-sm font-medium">Varsayılan değerler</div>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              {query.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <PermissionGate
                  permission="admin:settings"
                  fallback={<ReadOnlyView orderValue={orderSaved} woValue={woSaved} />}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <NumberSettingField
                      label="Sipariş termini"
                      hint="Sipariş açılışında deadline boşsa orderDate + N gün"
                      value={orderDraft}
                      onChange={setOrderDraft}
                    />
                    <NumberSettingField
                      label="İş emri planlama süresi"
                      hint="WO açılışında plannedEndDate boşsa start + N gün"
                      value={woDraft}
                      onChange={setWoDraft}
                    />
                  </div>

                  <div className="flex justify-end border-t pt-4">
                    <Button
                      size="sm"
                      disabled={!dirty || mut.isPending}
                      onClick={() => mut.mutate()}
                      className="gap-1.5"
                    >
                      <Save className="h-4 w-4" />
                      {mut.isPending ? "Kaydediliyor..." : "Kaydet"}
                    </Button>
                  </div>
                </PermissionGate>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function NumberSettingField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">{label}</label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={1}
          max={365}
          step={1}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n)) onChange(Math.min(365, Math.max(1, n)));
          }}
          className="w-24 text-center tabular-nums"
        />
        <span className="text-xs text-muted-foreground">gün</span>
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function ReadOnlyView({
  orderValue,
  woValue,
}: {
  orderValue: number;
  woValue: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <div className="text-xs text-muted-foreground">Sipariş termini</div>
        <div className="font-semibold">{orderValue} gün</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">İş emri planlama</div>
        <div className="font-semibold">{woValue} gün</div>
      </div>
    </div>
  );
}
