// =============================================================================
// FASON DOKUMA — dokuma işi detayı "Fason" bölümü: şerit + sevkler + makbuzlar + eylemler
// =============================================================================
// Yalnız `executionKind = SUBCONTRACTED` işte açılır (satır menüsü "Fason").
// Yazma eylemleri `weavingorder:write` (backend `requireAnyPermission` ile aynı); okuma
// `weavingorder:read` (ekranın kendisi). Levent DÖNÜŞÜ F1'in mevcut ucuyla (sevk satırı
// "Levent döndü"); dokuma belgeleri fason LİSTE sayfalarında görünmez — yalnız buradan.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PermissionGate } from "@/components/PermissionGate";
import { formatM } from "@/pages/Operations/WarpBeams/types";
import { WEAVING_STATUS_META, type WeavingOrder } from "../types";
import { fasonWeavingService } from "./service";
import { FASON_QUERY_KEY, useFasonMutations } from "./useFasonMutations";
import { DispatchList, ReceiptList, Stat } from "./FasonLists";
import { FasonModals, type FasonModal } from "./FasonModals";

export function FasonSheet({ order, onClose }: { order: WeavingOrder | null; onClose: () => void }) {
  const [modal, setModal] = useState<FasonModal>(null);
  const [failed, setFailed] = useState<{ index: number; message: string }[]>([]);
  const id = order?.id ?? "";
  const summary = useQuery({ queryKey: [FASON_QUERY_KEY, id], queryFn: () => fasonWeavingService.summary(id), enabled: Boolean(order) });
  const m = useFasonMutations(id, () => setModal(null));
  const s = summary.data?.data;
  const open = order ? WEAVING_STATUS_META[order.status].open : false;
  return (
    <Sheet open={Boolean(order)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[720px] overflow-y-auto sm:max-w-[720px]">
        {order && (
          <>
            <SheetHeader>
              <SheetTitle>{order.weavingOrderNumber} — fasonda dokunuyor</SheetTitle>
              <SheetDescription>
                Fasoncu <b>{order.subcontractor?.name ?? "—"}</b> · {order.item.name}
                {order.color ? ` · ${order.color.name}` : ""} · {WEAVING_STATUS_META[order.status].label}
              </SheetDescription>
            </SheetHeader>
            {summary.isError ? (
              <Callout tone="danger">Fason özeti alınamadı — bu bir “belge yok” cevabı DEĞİLDİR (modül kapalı, yetki yok ya da ağ).</Callout>
            ) : s ? (
              <div className="mt-4 space-y-5">
                <div className="grid grid-cols-4 gap-2 rounded-md border p-3 text-sm">
                  <Stat label="Giden levent" value={formatM(s.totals.sentM)} />
                  <Stat label="Dönen levent" value={formatM(s.totals.returnedM)} />
                  <Stat label="Doğan top" value={formatM(s.totals.bornM)} />
                  <Stat label="Fark (çözgü m)" value={formatM(s.totals.differenceM)} hint="çekme/take-up düşer; tek başına fire değildir" />
                </div>
                <PermissionGate permission="weavingorder:write">
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!open} onClick={() => setModal({ kind: "dispatch" })}>
                      Levent sevk et
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!open} onClick={() => { setFailed([]); setModal({ kind: "receive" }); }}>
                      Top kabul et
                    </Button>
                  </div>
                </PermissionGate>
                <DispatchList rows={s.dispatches} onCancel={(target) => setModal({ kind: "cancel-dispatch", target })} onReturn={(target) => setModal({ kind: "return-beam", target })} />
                <ReceiptList rows={s.receipts} onCancel={(target) => setModal({ kind: "cancel-receipt", target })} />
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">Yükleniyor…</p>
            )}
            <FasonModals order={order} modal={modal} m={m} failed={failed} onFailed={setFailed} onClose={() => setModal(null)} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
