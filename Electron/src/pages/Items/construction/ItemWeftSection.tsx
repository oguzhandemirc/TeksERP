// Ürün penceresi > Atkı (B19): atkı burada girilir (kayıtta arkada atkı kartı doğar, kod/ad üründen) ya da var olan kart seçilir.
// Kayıtlı kart düzenlenebilir; başka kumaşta da kullanılıyorsa bant uyarır, kayıtta "hepsinde mi / yalnız bu kumaşa kopya mı" sorulur.
import { useQuery } from "@tanstack/react-query";
import { Copy, PencilLine, Rows3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { InfoPopover } from "@/components/ui/info-popover";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { countWeftSpecUsers } from "@/pages/WeaveDesigns/service";
import { WeftContentFields } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { weftContentFromSpec } from "@/pages/WeaveDesigns/tabs/WeftSpecEditor";
import { weftSpecPickerService, type WeftSpecRef } from "../construction-service";
import type { ItemWeftDraft } from "./useItemWeftDraft";

const NEW_INFO = "Atkıyı burada girin; Kaydet'e basınca arkada bu kumaşa ait atkı kartı kendiliğinden açılır (kart kodu kumaş kodudur). "
  + "Aynı atkı başka kumaşta da kullanılacaksa sonra o kumaşta bu kartı seçebilirsiniz.";

export function ItemWeftSection({ draft, canWrite, itemId }: { draft: ItemWeftDraft; canWrite: boolean; itemId: string | null }) {
  const editableCard = draft.mode === "card" && !!draft.cardId && draft.cardId === draft.savedCardId && canWrite;
  const users = useQuery({
    queryKey: ["weft-specs", "users", draft.cardId],
    queryFn: () => countWeftSpecUsers(draft.cardId!),
    enabled: draft.mode === "card" && !!draft.cardId,
  });
  const others = Math.max(0, (users.data ?? 0) - (itemId && draft.cardId === draft.savedCardId ? 1 : 0));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          Atkı
          <InfoPopover label="Atkı nasıl girilir" desc={NEW_INFO} />
        </h3>
        <div className="ml-auto flex flex-wrap gap-2">
          {canWrite && draft.mode !== "new" && (
            <Button type="button" size="sm" variant={draft.mode === "none" ? "default" : "outline"} onClick={() => draft.startNew()}>
              <PencilLine className="mr-1.5 h-4 w-4" />Atkıyı burada gir
            </Button>
          )}
          <div className="w-64">
            <EntityPickerModal<WeftSpecRef>
              value={draft.mode === "card" ? draft.cardId : null}
              onChange={(id) => draft.pickCard(id)}
              service={weftSpecPickerService}
              queryKey="weft-specs-item"
              getLabel={(w) => w.name}
              getSubLabel={(w) => w.code}
              icon={Rows3}
              title="Var olan atkı kartını seç"
              placeholder="Var olan atkı kartını seç"
            />
          </div>
          {draft.mode !== "none" && (
            <Button type="button" size="sm" variant="ghost" onClick={draft.clear} aria-label="Atkıyı kaldır">
              <X className="mr-1 h-4 w-4" />Kaldır
            </Button>
          )}
        </div>
      </div>

      {draft.mode === "none" && (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground" data-testid="weft-empty">
          Bu kumaşa atkı girilmedi. "Atkıyı burada gir" ile iplikleri ve sırayı yazın ya da var olan bir atkı kartını seçin.
        </p>
      )}

      {draft.mode === "new" && (
        <>
          <p className="text-xs text-muted-foreground" data-testid="weft-new-note">Kaydedince bu kumaşa ait yeni atkı kartı açılır.</p>
          <WeftContentFields value={draft.content} onChange={draft.setContent} canWrite={canWrite} savedSeq="" idPrefix="iwf" />
        </>
      )}

      {draft.mode === "card" && draft.cardLoading && <p className="text-sm text-muted-foreground">Atkı kartı yükleniyor…</p>}

      {draft.mode === "card" && draft.card && (
        <>
          <p className="text-sm text-muted-foreground">
            Atkı kartı: <span className="font-mono text-xs">{draft.card.code}</span> · {draft.card.name}
          </p>
          {others > 0 && (
            <Callout tone="warning" title={`Bu atkı kartı ${others} kumaşta daha kullanılıyor`}>
              {editableCard
                ? "Değiştirip kaydederseniz hepsinde mi değişsin, yoksa yalnız bu kumaşa kopya mı açılsın diye sorulur."
                : "Seçerseniz bu kumaş da aynı kartı kullanır. Değiştirmek istiyorsanız kopyasını alın."}
            </Callout>
          )}
          <WeftContentFields
            value={editableCard ? draft.content : weftContentFromSpec(draft.card)}
            onChange={draft.setContent}
            canWrite={editableCard}
            savedSeq={draft.card.sequenceCode ?? ""}
            idPrefix="iwf"
          />
          {!editableCard && canWrite && (
            <Button type="button" size="sm" variant="outline" onClick={() => draft.startNew(weftContentFromSpec(draft.card!))}>
              <Copy className="mr-1.5 h-4 w-4" />Kopyasını al ve bu kumaş için değiştir
            </Button>
          )}
        </>
      )}
    </div>
  );
}
