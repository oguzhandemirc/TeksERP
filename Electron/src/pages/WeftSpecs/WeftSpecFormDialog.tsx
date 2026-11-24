// Atkı kartı oluştur / düzenle (B19 Atkı Kartları ekranı) — kod · ad + ürün penceresiyle AYNI atkı alanları (`WeftContentFields`).
// Doğrulamanın asıl kapısı sunucu (mükerrer kod/ad 409, iplik değil 400); panel `VarChar` sınırlarını aynalar.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SpecOpenOrdersNotice } from "@/components/production/SpecOpenOrdersNotice";
import { weftSpecApi } from "@/pages/WeaveDesigns/service";
import type { WeftSpecListRow } from "@/pages/WeaveDesigns/types";
import { buildWeftBody, EMPTY_WEFT, weftContentReady, WeftContentFields, type WeftContent } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { weftContentFromSpec } from "@/pages/WeaveDesigns/tabs/WeftSpecEditor";

export const WEFT_SPECS_QUERY_KEY = "weft-specs";
const FIRST_ROW: WeftContent = { ...EMPTY_WEFT, rows: [{ yarnItemId: "", picks: "" }] };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Düzenlenen kart; null = yeni kart. */
  initial: WeftSpecListRow | null;
  canWrite: boolean;
}

export function WeftSpecFormDialog({ open, onOpenChange, initial, canWrite }: Props) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState<WeftContent>(FIRST_ROW);
  useEffect(() => {
    if (!open) return;
    setCode(initial?.code ?? "");
    setName(initial?.name ?? "");
    setContent(initial ? weftContentFromSpec(initial) : FIRST_ROW);
  }, [open, initial]);
  const save = useMutation({
    mutationFn: () => {
      const body = { code: code.trim(), name: name.trim(), ...buildWeftBody(content.seq, content.picksPerCm, content.program, content.rows) };
      return initial ? weftSpecApi.update(initial.id, body) : weftSpecApi.create(body);
    },
    onSuccess: () => {
      toast.success(initial ? "Atkı kartı güncellendi." : "Atkı kartı oluşturuldu.");
      void qc.invalidateQueries({ queryKey: [WEFT_SPECS_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: ["item-construction"] });
      onOpenChange(false);
    },
  });
  const ready = code.trim() !== "" && name.trim() !== "" && weftContentReady(content);
  const others = initial ? initial.fabricCount : 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-4xl" data-form-size="wide">
        <DialogHeader>
          <DialogTitle>{initial ? "Atkı kartını düzenle" : "Yeni atkı kartı"}</DialogTitle>
          <DialogDescription>Atkı iplikleri, atkı sırası, sıklık ve tezgâh program numarası. Bir atkı kartı birden çok kumaşta kullanılabilir.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="ws-code">Atkı kartı kodu *</Label>
              <Input id="ws-code" value={code} maxLength={32} disabled={!canWrite} onChange={(e) => setCode(e.target.value)} placeholder="ör. 1205" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">Atkı kartı adı *</Label>
              <Input id="ws-name" value={name} maxLength={100} disabled={!canWrite} onChange={(e) => setName(e.target.value)} placeholder="ör. 600 KAR 70 DN – A4 B1" />
            </div>
          </div>
          {others > 1 && (
            <Callout tone="warning" title={`Bu atkı kartı ${others} kumaşta kullanılıyor`}>
              Kaydettiğiniz değişiklik hepsine yansır. Yalnız bir kumaşta değiştirmek için o kumaşın ürün penceresinde Atkı sekmesini kullanın.
            </Callout>
          )}
          {initial && canWrite && <SpecOpenOrdersNotice kind="weft" id={initial.id} />}
          <WeftContentFields value={content} onChange={setContent} canWrite={canWrite} savedSeq={initial?.sequenceCode ?? ""} idPrefix="wsf" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{canWrite ? "İptal" : "Kapat"}</Button>
          {canWrite && (
            <Button type="button" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Kaydediliyor..." : initial ? "Güncelle" : "Oluştur"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
