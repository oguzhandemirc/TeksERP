import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionGate } from "@/components/PermissionGate";
import { loadAllForPicker } from "@/lib/picker-loader";
import { returnReasonService } from "@/pages/ReturnReasons/service";
import { returnsService, type ReturnAppliedStatus, type ReturnRow } from "./service";

const DEC = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });
const TEXTAREA_CLS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const SHELF_LABEL: Record<ReturnAppliedStatus, string> = {
  WAREHOUSE: "Hazır Depo",
  A1_STOCK: "2. Kalite Stok",
  SCRAP: "Hurda",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{children}</span>
    </div>
  );
}

export function ReturnsDetailSheet({ row, onClose }: { row: ReturnRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [note, setNote] = useState("");

  // Düzelt formu kaynak satırla doldur (satır değişince).
  useEffect(() => {
    setReasonId(row?.reason?.id ?? null);
    setReasonText(row?.reasonText ?? "");
    setNote(row?.note ?? "");
    setEditing(false);
    setReason("");
  }, [row?.id]);

  const reasonsQ = useQuery({
    queryKey: ["return-reasons", "picker"],
    queryFn: () => loadAllForPicker(returnReasonService, { sortBy: "sortOrder" }),
    enabled: editing,
    staleTime: 5 * 60_000,
  });
  const reasons = useMemo(
    () => (reasonsQ.data?.data ?? []).filter((r) => r.isActive),
    [reasonsQ.data?.data],
  );

  const cancelMut = useMutation({
    mutationFn: () => returnsService.cancel(row!.id, reason.trim()),
    onSuccess: () => {
      toast.success("İade iptal edildi — top sevkiyatına geri döndü.");
      void qc.invalidateQueries({ queryKey: ["returns"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      setReason("");
      onClose();
    },
  });

  const editMut = useMutation({
    mutationFn: () =>
      returnsService.edit(row!.id, {
        reasonId,
        reasonText: reasonText.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success("İade kaydı güncellendi.");
      void qc.invalidateQueries({ queryKey: ["returns"] });
      setEditing(false);
    },
  });

  const cancelled = !!row?.cancelledAt;
  const shelf = row?.appliedStatus && row.appliedStatus !== "WAREHOUSE" ? SHELF_LABEL[row.appliedStatus] : null;
  const hasReason = !!reasonId || reasonText.trim().length > 0;

  return (
    <Sheet
      open={!!row}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="font-mono">{row.roll?.barcode ?? "—"}</span>
                {cancelled ? <Badge variant="destructive">İptal</Badge> : <Badge variant="secondary">İade</Badge>}
                {shelf && <Badge variant="outline">{shelf}</Badge>}
              </SheetTitle>
              <SheetDescription>
                {row.item?.name ?? "—"}
                {row.color ? ` · ${row.color.name}` : ""}
                {row.width != null ? ` · ${row.width} cm` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-3">
              <div className="space-y-2 rounded-md border bg-card/40 p-3">
                <Row label="Metraj">{DEC.format(row.qty)} m</Row>
                <Row label="Müşteri">{row.customer?.name ?? "—"}</Row>
                <Row label="Sipariş">{row.order?.orderNumber ?? "—"}</Row>
                <Row label="Sevkiyat">{row.fromShipment?.shipmentNo ?? "—"}</Row>
                <Row label="Neden">{row.reason?.name ?? row.reasonText ?? "—"}</Row>
                {row.reason && row.reasonText && <Row label="Açıklama">{row.reasonText}</Row>}
                {row.qualityGrade && <Row label="Kalite">{row.qualityGrade.name}</Row>}
                {shelf && <Row label="İade rafı">{shelf}</Row>}
                {row.note && <Row label="Not">{row.note}</Row>}
                <Row label="Teslim alan">{row.receivedBy?.fullName ?? "—"}</Row>
                <Row label="Tarih">{safeFormat(row.createdAt, "dd.MM.yyyy HH:mm")}</Row>
              </div>

              {cancelled ? (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">İptal Edildi</div>
                  <div className="font-medium">{row.cancelReason ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.cancelledBy?.fullName ?? "—"} · {safeFormat(row.cancelledAt!, "dd.MM.yyyy HH:mm")}
                  </div>
                </div>
              ) : (
                <PermissionGate permission="return:write">
                  {/* Düzelt — yalnız neden + not (top durumu değişmez). */}
                  {editing ? (
                    <div className="space-y-2 rounded-md border p-3">
                      <div className="text-xs font-semibold uppercase text-muted-foreground">Düzelt (neden + not)</div>
                      <Select value={reasonId ?? ""} onValueChange={(v) => setReasonId(v || null)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Neden seçin..." />
                        </SelectTrigger>
                        <SelectContent>
                          {reasons.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <textarea
                        className={TEXTAREA_CLS}
                        rows={2}
                        placeholder="Açıklama (katalog seçmediysen yaz)"
                        value={reasonText}
                        onChange={(e) => setReasonText(e.target.value)}
                      />
                      <textarea
                        className={TEXTAREA_CLS}
                        rows={2}
                        placeholder="Not (teslim alan)"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>
                          Vazgeç
                        </Button>
                        <Button
                          className="flex-1"
                          disabled={!hasReason || editMut.isPending}
                          onClick={() => editMut.mutate()}
                        >
                          {editMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                          Kaydet
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full" onClick={() => setEditing(true)}>
                      <Pencil className="mr-1 h-4 w-4" />
                      Düzelt (neden / not)
                    </Button>
                  )}

                  {/* İptal (geri al) — somut etkilenen kayıt listelenir. */}
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">İadeyi İptal Et (geri al)</div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{row.roll?.barcode ?? "Top"}</span>
                      {" ("}
                      {DEC.format(row.qty)} m{row.item ? ` · ${row.item.name}` : ""}
                      {")"} →{" "}
                      <span className="font-medium text-foreground">{row.fromShipment?.shipmentNo ?? "sevkiyatına"}</span>{" "}
                      <span className="font-medium text-foreground">SHIPPED</span> olarak geri dönecek
                      {shelf ? ` (şu an ${shelf}'te).` : "."} Sadece top iade sonrası işlem görmediyse mümkün.
                    </p>
                    <Input
                      placeholder="İptal sebebi (örn. yanlış top okutuldu)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <Button
                      variant="destructive"
                      className="w-full"
                      disabled={reason.trim().length < 3 || cancelMut.isPending}
                      onClick={() => cancelMut.mutate()}
                    >
                      {cancelMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                      İadeyi İptal Et
                    </Button>
                  </div>
                </PermissionGate>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
