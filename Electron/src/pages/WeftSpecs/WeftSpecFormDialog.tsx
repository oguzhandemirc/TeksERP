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
import type { WeftSpecDetail, WeftSpecListRow } from "@/pages/WeaveDesigns/types";
import { buildWeftBody, EMPTY_WEFT, weftContentReady, WeftContentFields, type WeftContent } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { weftContentFromSpec } from "@/pages/WeaveDesigns/tabs/WeftSpecEditor";
import { WeftCalcPanel } from "./WeftCalcPanel";
import type { WeftCalcCtx } from "./weft-calc";

export const WEFT_SPECS_QUERY_KEY = "weft-specs";
const FIRST_ROW: WeftContent = { ...EMPTY_WEFT, rows: [{ yarnItemId: "", picks: "" }] };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Düzenlenen kart; null = yeni kart. */
  initial: WeftSpecListRow | null;
  canWrite: boolean;
  /** Seçicinin "Örnek al" taslağı (kimliksiz): kod boş, ad "(kopya)" önerisiyle; yalnız YENİ kart açar. */
  draft?: Omit<WeftSpecDetail, "id"> | null;
  /** Seçicinin kayıt formu (`useWeftSpecRecordForm`) kaydı kendisi yapar; yoksa pencere kendi kaydeder. */
  onSubmit?: (body: Record<string, unknown>) => Promise<void>;
  /** Ürün penceresinden açıldıysa kumaş bağlamı: hesap paneli atkı boyunu kumaşın zincirinden alır (kart değişmez). */
  calcCtx?: WeftCalcCtx;
}

export function WeftSpecFormDialog({ open, onOpenChange, initial, canWrite, draft = null, onSubmit, calcCtx }: Props) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState<WeftContent>(FIRST_ROW);
  useEffect(() => {
    if (!open) return;
    setCode(initial?.code ?? "");
    setName(initial?.name ?? (draft?.name ? `${draft.name} (kopya)` : ""));
    const source = initial ?? draft;
    setContent(source ? weftContentFromSpec(source) : FIRST_ROW);
  }, [open, initial, draft]);
  const save = useMutation({
    mutationFn: async () => {
      const body = { code: code.trim(), name: name.trim(), ...buildWeftBody(content.seq, content.picksPerCm, content.program, content.rows) };
      if (onSubmit) return onSubmit(body);
      return initial ? weftSpecApi.update(initial.id, body) : weftSpecApi.create(body);
    },
    onSuccess: () => {
      if (onSubmit) return; // bildirim, tazeleme ve kapatma kayıt formunda (useRecordForm)
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
      <DialogContent className="w-[calc(100%-2rem)] max-w-6xl" data-form-size="wide">
        <DialogHeader>
          <DialogTitle>{initial ? "Atkı kartını düzenle" : "Yeni atkı kartı"}</DialogTitle>
          <DialogDescription>Atkı iplikleri, atkı raporu, sıklık ve tezgâh program numarası. Bir atkı kartı birden çok kumaşta kullanılabilir.</DialogDescription>
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
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <WeftContentFields value={content} onChange={setContent} canWrite={canWrite} savedSeq={initial?.sequenceCode ?? ""} idPrefix="wsf" />
            <WeftCalcPanel content={content} ctx={calcCtx} />
          </div>
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
