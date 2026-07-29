import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { shipmentService } from "./service";

/**
 * İrsaliye açıklaması editörü — sevkiyata KAYITLI serbest not (annotation).
 * Kendi kendine yeter: notu okur, düzenler, "Kaydet" ile yazar. SÜRÜM DOĞURMAZ;
 * belge basılırken canlı çözülür → tekrar baskıda güncel çıkar. Opsiyonel, boş
 * bırakılabilir (uyarı yok). Hem sevkiyat detayında hem irsaliye modalında kullanılır.
 */
export function DispatchNoteEditor({
  shipmentId,
  onSaved,
}: {
  shipmentId: string;
  /** Kaydedince çağrılır — çağıran ilgili query'lerini (ör. baskı önizlemesi) tazeler. */
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["dispatch-note", shipmentId],
    queryFn: () => shipmentService.getDispatchNote(shipmentId),
    staleTime: 30_000,
  });
  const saved = q.data?.data?.dispatchNote ?? "";

  const [text, setText] = useState(saved);
  useEffect(() => {
    setText(saved);
  }, [saved]);
  const dirty = text.trim() !== saved.trim();

  const mut = useMutation({
    mutationFn: () => shipmentService.setDispatchNote(shipmentId, text.trim() || null),
    onSuccess: () => {
      toast.success("İrsaliye açıklaması kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["dispatch-note", shipmentId] });
      onSaved?.();
    },
  });

  return (
    <PermissionGate
      permission="shipping:write"
      fallback={saved ? <p className="text-xs text-muted-foreground">Açıklama: {saved}</p> : null}
    >
      <div className="flex items-start gap-2">
        <FileText className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <textarea
          value={text}
          maxLength={500}
          rows={2}
          disabled={q.isLoading || mut.isPending}
          onChange={(e) => setText(e.target.value)}
          placeholder="İrsaliye açıklaması (opsiyonel — kaydedilir, irsaliyeye basılır)…"
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button
          type="button"
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || mut.isPending}
          onClick={() => mut.mutate()}
          className="mt-0.5 shrink-0"
          title="Açıklamayı sevkiyata kaydet (sürüm doğurmaz)"
        >
          {mut.isPending ? "…" : "Kaydet"}
        </Button>
      </div>
    </PermissionGate>
  );
}
