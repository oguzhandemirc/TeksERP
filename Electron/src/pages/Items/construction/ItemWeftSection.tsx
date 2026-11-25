// Ürün penceresi > Atkı (B19): atkı burada girilir (kayıtta arkada atkı kartı doğar, kod/ad üründen) ya da var olan kart seçilir.
// Kayıtlı kart yalnız bu kumaşa aitse yerinde düzenlenir; paylaşılan (ya da kullanımı bilinmeyen) kart kilitli — "yalnız bu kumaş için
// kopya" ya da Atkı Kartları ekranı (kullanıcı 2026-11-25: override yalnız tanımın asıl yerinden).
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, PencilLine, Rows3, X } from "lucide-react";
import { openWeftSpecsTab } from "@/pages/WeftSpecs/open-weft-specs";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { InfoPopover } from "@/components/ui/info-popover";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { weftSpecApi } from "@/pages/WeaveDesigns/service";
import { WeftContentFields } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { weftContentFromSpec } from "@/pages/WeaveDesigns/tabs/WeftSpecEditor";
import { weftSpecPickerService, type WeftSpecRef } from "../construction-service";
import { cardEditableInPlace, type ItemWeftDraft } from "./useItemWeftDraft";
import { WeftCalcPanel } from "@/pages/WeftSpecs/WeftCalcPanel";
import { positiveOrNull } from "@/pages/WeftSpecs/weft-calc";

const CALC_GRID = "grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]";

const NEW_INFO = "Atkıyı burada girin; Kaydet'e basınca arkada bu kumaşa ait atkı kartı kendiliğinden açılır (kart kodu kumaş kodudur). "
  + "Aynı atkı başka kumaşta da kullanılacaksa sonra o kumaşta bu kartı seçebilirsiniz.";

function shareTitle(others: number | null): string {
  return others === null ? "Bu atkı kartının başka kumaşlarda kullanılıp kullanılmadığı bilinmiyor" : `Bu atkı kartı ${others} kumaşta daha kullanılıyor`;
}

function OpenWeftSpecsButton({ code }: { code: string }) {
  return (
    <Button type="button" size="sm" variant="ghost" onClick={() => openWeftSpecsTab(code)}>
      <ExternalLink className="mr-1.5 h-4 w-4" />Atkı Kartları ekranında aç
    </Button>
  );
}

interface NoticeProps { draft: ItemWeftDraft; code: string; savedCard: boolean; editable: boolean; canWrite: boolean }

// Kartın üstündeki bant: kopya kipi · paylaşılan kayıtlı kart kilidi (kopya / asıl yer) · seçilen ortak kart uyarısı.
function CardNotice({ draft, code, savedCard, editable, canWrite }: NoticeProps) {
  if (draft.forking) {
    return (
      <Callout tone="info" title="Yalnız bu kumaş için kopya">
        Kaydedince bu kumaşa kartın kopyası açılır, değişiklik ona yazılır; öteki kumaşlar eski kartta kalır.
      </Callout>
    );
  }
  if (savedCard && !editable) {
    return (
      <Callout tone="warning" title={shareTitle(draft.others)}>
        Ortak atkı kartı burada değiştirilmez. Yalnız bu kumaşı değiştirmek için kopya açın; bütün kumaşlar için Atkı Kartları ekranında düzeltin.
        <div className="mt-2 flex flex-wrap gap-2" data-testid="weft-shared-lock">
          {canWrite && (
            <Button type="button" size="sm" variant="outline" onClick={draft.startFork}>
              <Copy className="mr-1.5 h-4 w-4" />Yalnız bu kumaş için kopya
            </Button>
          )}
          <OpenWeftSpecsButton code={code} />
        </div>
      </Callout>
    );
  }
  if (!savedCard && draft.others) {
    return (
      <Callout tone="warning" title={shareTitle(draft.others)}>
        Seçerseniz bu kumaş da aynı kartı kullanır. Değiştirmek istiyorsanız örnek alıp bu kumaşa yeni atkı açın.
      </Callout>
    );
  }
  return null;
}

interface SectionProps {
  draft: ItemWeftDraft; canWrite: boolean;
  /** K4 hesap bağlamı: kayıtlı kumaşın zinciri (boy/fire) + formdaki ham en. */
  itemId?: string | null; rawWidthText?: string;
}

export function ItemWeftSection({ draft, canWrite, itemId, rawWidthText }: SectionProps) {
  const calcCtx = { itemId, rawWidthCm: positiveOrNull(rawWidthText) };
  const savedCard = draft.mode === "card" && !!draft.cardId && draft.cardId === draft.savedCardId;
  // Yerinde düzenleme yalnız bu kumaşa ait kartta; paylaşılan/bilinmeyen kartta yalnız "kopya" seçildikten sonra.
  const editableCard = savedCard && canWrite && (draft.forking || cardEditableInPlace(draft));
  // Hiç atkı kartı yokken "var olan kartı seç" boş bir liste açardı — o zaman gösterilmez.
  const anyCard = useQuery({ queryKey: ["weft-specs", "list", "", false], queryFn: () => weftSpecApi.list() });
  const showPicker = draft.mode === "card" || (anyCard.data?.length ?? 0) > 0;
  const shown = draft.card && !editableCard ? weftContentFromSpec(draft.card) : draft.content;
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
          {showPicker && <div className="w-64">
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
          </div>}
          {draft.mode !== "none" && (
            <Button type="button" size="sm" variant="ghost" onClick={draft.clear} aria-label="Atkıyı kaldır">
              <X className="mr-1 h-4 w-4" />Kaldır
            </Button>
          )}
        </div>
      </div>

      {draft.mode === "none" && (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground" data-testid="weft-empty">
          Bu kumaşa atkı girilmedi. "Atkıyı burada gir" ile iplikleri ve sırayı yazın{showPicker ? " ya da var olan bir atkı kartını seçin" : ""}.
        </p>
      )}

      {draft.mode === "new" && (
        <>
          <p className="text-xs text-muted-foreground" data-testid="weft-new-note">Kaydedince bu kumaşa ait yeni atkı kartı açılır.</p>
          <div className={CALC_GRID}>
            <WeftContentFields value={draft.content} onChange={draft.setContent} canWrite={canWrite} savedSeq="" idPrefix="iwf" />
            <WeftCalcPanel content={draft.content} ctx={calcCtx} />
          </div>
        </>
      )}

      {draft.mode === "card" && draft.cardLoading && <p className="text-sm text-muted-foreground">Atkı kartı yükleniyor…</p>}

      {draft.mode === "card" && draft.card && (
        <>
          <p className="text-sm text-muted-foreground">
            Atkı kartı: <span className="font-mono text-xs">{draft.card.code}</span> · {draft.card.name}
          </p>
          <CardNotice draft={draft} code={draft.card.code} savedCard={savedCard} editable={editableCard} canWrite={canWrite} />
          <div className={CALC_GRID}>
            <WeftContentFields value={shown} onChange={draft.setContent} canWrite={editableCard} savedSeq={draft.card.sequenceCode ?? ""} idPrefix="iwf" />
            <WeftCalcPanel content={shown} ctx={calcCtx} />
          </div>
          {!savedCard && canWrite && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => draft.startNew(weftContentFromSpec(draft.card!))}>
                <Copy className="mr-1.5 h-4 w-4" />Örnek alarak yeni aç
              </Button>
              <OpenWeftSpecsButton code={draft.card.code} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
