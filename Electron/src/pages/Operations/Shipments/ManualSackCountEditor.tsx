import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/PermissionGate";
import { useShipmentManualSackCountEnabled } from "@/hooks/usePricingEnabled";
import { shipmentService } from "./service";

/**
 * "Araca yüklenen çuval adedi" — operatörün beyanı.
 *
 * Neden var: sahada 10 çuval gönderilse bile hepsi tek bir çuval kaydının içine
 * yazılıyor. Sistemin saydığı adet o yüzden fiziksel gerçeği vermiyor ve
 * irsaliyede "1 çuval" yazan bir araç 10 çuvalla yola çıkıyor.
 *
 * `DispatchNoteEditor` ile AYNI KATMAN (annotation): sürüm doğurmaz, her an
 * düzenlenebilir, belge basılırken canlı çözülür.
 *
 * ⚠️ Bayrak kapalıyken HİÇ ÇİZİLMEZ. Backend de yazmayı reddediyor — UI'da
 * gizlemek tek başına yetmez, alan doğrudan uçtan da doldurulabilirdi.
 *
 * ⚠️ Boş bırakılabilir: beyan yoksa belge bugünkü gibi basılır (yalnız sistemin
 * saydığı rakam). Operatörü tıkamamak bilinçli — acele bir sevkte bir alan daha
 * doldurmak zorunda kalmasın.
 */
export function ManualSackCountEditor({
  shipmentId,
  systemCount,
  value,
  onSaved,
}: {
  shipmentId: string;
  /** Sistemin saydığı çuval KAYDI adedi — karşılaştırma için gösterilir. */
  systemCount: number;
  /** Kayıtlı beyan (null = beyan yok). */
  value: number | null;
  onSaved?: () => void;
}) {
  const enabled = useShipmentManualSackCountEnabled();
  const qc = useQueryClient();
  const [text, setText] = useState(value == null ? "" : String(value));

  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);

  const parsed = text.trim() === "" ? null : Number.parseInt(text.trim(), 10);
  const gecersiz = text.trim() !== "" && (!Number.isFinite(parsed) || parsed! < 1 || parsed! > 9999);
  const dirty = !gecersiz && parsed !== value;

  const mut = useMutation({
    mutationFn: () => shipmentService.setManualSackCount(shipmentId, parsed),
    onSuccess: () => {
      toast.success(parsed == null ? "Çuval adedi beyanı kaldırıldı." : "Çuval adedi kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      onSaved?.();
    },
  });

  if (!enabled) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Package className="h-3.5 w-3.5" />
        Araca yüklenen çuval adedi
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
          placeholder={String(systemCount)}
          inputMode="numeric"
          className="h-8 w-24"
          aria-label="Araca yüklenen çuval adedi"
        />
        <span className="text-xs text-muted-foreground">
          sistemde <b className="font-mono">{systemCount}</b> kayıt
        </span>
        <PermissionGate permission="shipping:write">
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || mut.isPending}
            onClick={() => mut.mutate()}
          >
            Kaydet
          </Button>
        </PermissionGate>
      </div>
      {gecersiz ? (
        <p className="text-[11px] text-destructive">1 ile 9999 arasında bir sayı girin.</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Boş bırakılırsa belgede yalnız sistemin saydığı rakam çıkar.
        </p>
      )}
    </div>
  );
}
