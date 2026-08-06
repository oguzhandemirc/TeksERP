import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { QuickAddProperty } from "@/components/forms/QuickAddProperty";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { stationCapabilityService } from "@/pages/StationCapabilities/service";

interface Props {
  stationId: string;
  colorId: string | null;
  propertyIds: string[];
  onColor: (id: string | null) => void;
  onProperties: (ids: string[]) => void;
}

/**
 * Rota adımının ŞABLON HEDEFİ — "bu akışta boyahane MAVİ basar, zımpara
 * ZIMPARALI kazandırır". İş emri açılışında rota seçilince bu değerler hedef
 * alanlara ön-doldurulur; operatör değiştirebilir (şablon bir ÖNERİDİR).
 *
 * İş emri formundaki `RouteStepDetail`'in kardeşidir ve AYNI kuralları uygular:
 * renk yalnız "renk veren kategori" adımlarında sorulur (istasyonun renk
 * listesi OKUNMAZ — 2026-08-02 kuralı, tüm katalog gösterilir), özellik ise
 * gerçek proses kısıtı olduğu için istasyonun yetenek listesiyle sınırlıdır.
 * Backend `route.service.applyStepTargets` aynı iki kuralı ikinci hat olarak
 * dayatır — buradaki koşulları gevşetirsen 400 alırsın, sessiz sapma olmaz.
 */
export function RouteStepTargets({
  stationId,
  colorId,
  propertyIds,
  onColor,
  onProperties,
}: Props) {
  const { hasPermission } = useRoleAccess();
  const canWriteProperty = hasPermission("property:write");

  const capQ = useQuery({
    queryKey: ["station-capabilities", stationId],
    queryFn: () => stationCapabilityService.getByStation(stationId),
    enabled: Boolean(stationId),
    staleTime: 300_000,
  });
  const cap = capQ.data?.data;

  const selected = useMemo(() => new Set(propertyIds), [propertyIds]);

  const toggle = (id: string) => {
    const next = new Set(propertyIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onProperties([...next]);
  };

  if (!stationId) return null;
  if (capQ.isLoading) {
    return <div className="text-[11px] text-muted-foreground">Yetenekler yükleniyor...</div>;
  }

  const appliesColor = Boolean(cap?.hasDefaultCategory && cap.canApplyColor);
  const appliesProperty = Boolean(cap?.canApplyProperty);

  // "Uygulamaz" ile "listesi boş" AYRI cümlelerdir — yetenek listesi hiç
  // doldurulmamış bir istasyon, sistem öyle tasarlanmış sanılarak geçilmesin.
  if (!cap || (!appliesColor && !appliesProperty)) {
    return (
      <div className="text-[11px] text-muted-foreground">
        Bu istasyon renk/özellik uygulamaz — sadece işlem yapar.
      </div>
    );
  }

  const propertyListEmpty = appliesProperty && cap.properties.length === 0;

  return (
    <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-2">
      {appliesColor && (
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            Bu adımda uygulanan renk{" "}
            <span className="text-muted-foreground/70">(opsiyonel)</span>
          </label>
          <ColorPickerModal
            value={colorId}
            onChange={onColor}
            triggerClassName="h-8 text-xs"
            placeholder="Renk seç..."
          />
        </div>
      )}

      {appliesProperty && (
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            Bu adımda uygulanan özellikler
          </label>
          {propertyListEmpty ? (
            <div className="text-[11px] italic text-muted-foreground">
              Bu istasyonun yetenek listesi boş — henüz hiçbir özellik tanımlanmamış.
              Aşağıdan ekleyebilir ya da Tanımlar → Kumaş Özellikleri'nden bu istasyona
              atayabilirsiniz.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {cap.properties.map((p) => {
                const on = selected.has(p.id);
                return (
                  <Badge
                    key={p.id}
                    variant={on ? "default" : "outline"}
                    className={cn(
                      "cursor-pointer gap-1 text-[10px]",
                      on && "border-transparent bg-emerald-600 text-white hover:bg-emerald-600/85",
                    )}
                    onClick={() => toggle(p.id)}
                  >
                    {on && <Check className="h-3 w-3" />}
                    {p.name}
                  </Badge>
                );
              })}
            </div>
          )}
          {/* İstasyon zaten belli — yeni özellik ona BAĞLI doğar ve anında seçili
              gelir (ikinci ekran yok). */}
          {canWriteProperty && (
            <div className="pt-1">
              <QuickAddProperty
                label="Yeni özellik tanımla"
                defaultStationId={stationId}
                onCreated={(id) => {
                  void capQ.refetch();
                  if (!selected.has(id)) onProperties([...propertyIds, id]);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
