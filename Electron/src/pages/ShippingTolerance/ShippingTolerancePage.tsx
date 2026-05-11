import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { safeFormat } from "@/lib/format";
import { Truck, Save, Minus, Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { systemSettingService, SETTING_KEYS } from "@/services/systemSettingService";

const KEY = SETTING_KEYS.SHIPPING_TOLERANCE_METERS;
const QUERY_KEY = "system-settings";
const STEP = 0.5;
const MIN = 0;
const MAX = 9999;
const DEFAULT_VALUE = 5;

function formatMeters(n: number): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);
}

export function ShippingTolerancePage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: systemSettingService.list,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const setting = query.data?.data?.find((s) => s.key === KEY);
  const savedValue = setting ? parseFloat(setting.value) : DEFAULT_VALUE;
  const cleanSaved = Number.isFinite(savedValue) && savedValue >= 0 ? savedValue : DEFAULT_VALUE;

  const [draft, setDraft] = useState<number>(cleanSaved);
  useEffect(() => setDraft(cleanSaved), [cleanSaved]);

  const dirty = draft !== cleanSaved;

  const mutation = useMutation({
    mutationFn: (value: number) => systemSettingService.upsert(KEY, String(value)),
    onSuccess: () => {
      toast.success("Tolerans güncellendi.");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const adjust = (delta: number) => {
    const next = Math.min(MAX, Math.max(MIN, Number((draft + delta).toFixed(2))));
    setDraft(next);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sevk Eksiklik Toleransı"
        description="Sipariş, eksik metraja rağmen tamamen kapanmış sayılır."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-4 p-6">
          {/* Açıklama */}
          <Card>
            <CardContent className="flex gap-4 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <Truck className="h-5 w-5" />
              </div>
              <div className="space-y-1.5 text-sm">
                <p className="font-medium">Tolerans nedir?</p>
                <p className="text-muted-foreground">
                  Üretim sırasında küçük metraj kayıpları olur. Tolerans, siparişin tam kapanması için kabul ettiğin "fire payı"dır.
                </p>
                <div className="mt-2 rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Örnek:</span> 100 m sipariş, tolerans 5 m. Sevk 95 m olsa bile sipariş{" "}
                  <span className="font-medium text-foreground">Tamamlandı</span> olur. 94 m sevkte sipariş{" "}
                  <span className="font-medium text-foreground">Kısmi Sevk</span> olarak açık kalır.
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Değer kartı */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Mevcut tolerans</div>
                  {query.isLoading ? (
                    <Skeleton className="mt-1 h-9 w-32" />
                  ) : (
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-3xl font-semibold tabular-nums">{formatMeters(cleanSaved)}</span>
                      <span className="text-sm text-muted-foreground">metre</span>
                    </div>
                  )}
                </div>
                {!query.isLoading && setting && (
                  <div className="text-right text-xs text-muted-foreground">
                    <div>Son güncelleme</div>
                    <div className="text-foreground">
                      {safeFormat(setting.updatedAt, "dd.MM.yyyy HH:mm")}
                    </div>
                    {setting.updatedBy?.fullName && <div>{setting.updatedBy.fullName}</div>}
                  </div>
                )}
                {!query.isLoading && !setting && (
                  <div className="text-right text-xs text-muted-foreground">
                    Varsayılan değer kullanılıyor
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Yeni değer
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => adjust(-STEP)}
                    disabled={draft <= MIN}
                    aria-label="Azalt"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <input
                    type="number"
                    min={MIN}
                    max={MAX}
                    step={STEP}
                    value={draft}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (Number.isFinite(n)) setDraft(Math.min(MAX, Math.max(MIN, n)));
                    }}
                    className="h-12 w-32 rounded-md border bg-background text-center text-2xl font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-sm text-muted-foreground">metre</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => adjust(STEP)}
                    disabled={draft >= MAX}
                    aria-label="Artır"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <div className="ml-auto flex gap-1">
                    {[0, 5, 10, 25].map((v) => (
                      <Button
                        key={v}
                        type="button"
                        variant={draft === v ? "default" : "outline"}
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => setDraft(v)}
                      >
                        {v} m
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {draft === 0
                    ? "0 metre — eksik sevkte sipariş otomatik kapanmaz."
                    : `Sevk anında en fazla ${formatMeters(draft)} m eksiklik kabul edilir.`}
                </p>
              </div>

              <div className="flex items-center justify-between border-t pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!dirty}
                  onClick={() => setDraft(cleanSaved)}
                >
                  İptal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  disabled={!dirty || mutation.isPending}
                  onClick={() => mutation.mutate(draft)}
                >
                  {mutation.isPending ? (
                    <>Kaydediliyor...</>
                  ) : dirty ? (
                    <>
                      <Save className="h-4 w-4" /> Değişikliği Kaydet
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" /> Kaydedildi
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
