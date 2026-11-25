// Atkı içeriği alanları (kontrollü): sıra kodu · sıklık · program no · kutu şeridi · A/B/C iplik satırları.
// İki yerde aynı: Desen kartı > Atkı sekmesi (`WeftSpecEditor`, kayıtlı kart) ve ürün penceresi > Atkı (taslak, B19).
import { Package, Trash2 } from "lucide-react";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { Button } from "@/components/ui/button";
import { useDirtyTab } from "@/components/layout/tabs/dirty-tabs";
import { InfoPopover } from "@/components/ui/info-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SequenceBoxEditor } from "@/components/weave/SequenceBoxEditor";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";

export interface WeftRow { yarnItemId: string; picks: string }
export interface WeftContent { seq: string; picksPerCm: string; program: string; rows: WeftRow[] }

export const MAX_WEFT_LINES = 26;
export const weftLetter = (i: number) => String.fromCharCode(65 + i);
export const EMPTY_WEFT: WeftContent = { seq: "", picksPerCm: "", program: "", rows: [] };
// SY-a: pul/payet satırı seçicide ayırt edilsin — denyesiz girer, maliyeti adet/metre fiyatından.
const FANCY_SUB: Record<string, string> = { ADET: "pul/payet · adetle", METRE: "fantezi · metreyle" };
const yarnSubLabel = (it: Item): string => (it.yarnPurchaseUnit && FANCY_SUB[it.yarnPurchaseUnit] ? `${it.code} · ${FANCY_SUB[it.yarnPurchaseUnit]}` : it.code);

export function buildWeftBody(seq: string, picksPerCm: string, program: string, rows: WeftRow[]): Record<string, unknown> {
  const sequence = seq.trim();
  return {
    sequenceCode: sequence === "" ? null : sequence,
    picksPerCm: picksPerCm.trim() === "" ? null : picksPerCm.trim().replace(",", "."),
    weftProgramNo: program.trim() === "" ? null : program.trim(),
    yarns: rows.map((r) => (sequence === "" ? { yarnItemId: r.yarnItemId, picksInRepeat: Number(r.picks) } : { yarnItemId: r.yarnItemId })),
  };
}

/** Kaydedilebilir mi: en az bir satır, her satırda iplik, sıra kodu yoksa adet > 0. */
export function weftContentReady(c: WeftContent): boolean {
  const derived = c.seq.trim() !== "";
  return c.rows.length > 0 && c.rows.every((r) => r.yarnItemId && (derived || Number(r.picks) > 0));
}

/** Hiçbir şey girilmemiş mi (taslak gönderilmez). */
export function weftContentBlank(c: WeftContent): boolean {
  return c.seq.trim() === "" && c.picksPerCm.trim() === "" && c.program.trim() === "" && c.rows.every((r) => !r.yarnItemId && !r.picks.trim());
}

interface Props {
  value: WeftContent;
  onChange: (next: WeftContent) => void;
  canWrite: boolean;
  /** Kayıtlı sıra kodu — kirli sekme ölçüsü. */
  savedSeq: string;
  idPrefix?: string;
  /** Satır sonu ek hücre (pay %) — verilirse ızgara bir sütun genişler. */
  rowExtra?: (index: number) => React.ReactNode;
  header?: React.ReactNode;
}

export function WeftContentFields({ value, onChange, canWrite, savedSeq, idPrefix = "wf", rowExtra, header }: Props) {
  const { seq, picksPerCm, program, rows } = value;
  const derived = seq.trim() !== "";
  const set = (patch: Partial<WeftContent>) => onChange({ ...value, ...patch });
  const setRow = (i: number, patch: Partial<WeftRow>) => set({ rows: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const grid = rowExtra ? "grid items-center gap-2 sm:grid-cols-[2rem_1fr_8rem_4.5rem_2.5rem]" : "grid items-center gap-2 sm:grid-cols-[2rem_1fr_8rem_2.5rem]";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor={`${idPrefix}-seq`}>Atkı sırası kodu</Label>
            {/* -my-1: ⓘ (20 px) etiket satırını büyütmesin, yandaki etiketlerle aynı hizada kalsın (FormField `info` ile aynı yol). */}
            <InfoPopover label="Sıra kodu nasıl yazılır" desc={SEQ_INFO} className="-my-1" />
          </div>
          <Input id={`${idPrefix}-seq`} value={seq} maxLength={120} disabled={!canWrite} onChange={(e) => set({ seq: e.target.value })} placeholder="ör. 10x(A2 B2 C1) D4" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-ppc`}>Atkı sıklığı (atkı/cm)</Label>
          <Input id={`${idPrefix}-ppc`} value={picksPerCm} inputMode="decimal" disabled={!canWrite} onChange={(e) => set({ picksPerCm: e.target.value })} placeholder="ör. 22" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-prog`}>Atkı program no</Label>
          <Input id={`${idPrefix}-prog`} value={program} maxLength={16} disabled={!canWrite} onChange={(e) => set({ program: e.target.value })} placeholder="ör. 6037" />
        </div>
      </div>
      <WeftBoxSection seq={seq} saved={savedSeq} letterCount={rows.length} canWrite={canWrite} onChange={(c) => set({ seq: c })} />
      {rows.length > 0 && (header ?? <WeftRowsHeader />)}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className={grid}>
            <span className="font-mono text-sm font-semibold">{weftLetter(i)}</span>
            <EntityPickerModal<Item>
              value={r.yarnItemId || null}
              onChange={(id) => setRow(i, { yarnItemId: id ?? "" })}
              service={itemService}
              queryKey="items-weft-yarn"
              filters={{ itemType: "YARN", lifecycleStatus: "ACTIVE" }}
              getLabel={(it) => it.name}
              getSubLabel={yarnSubLabel}
              icon={Package}
              title={`Atkı ${weftLetter(i)} ipliği seç`}
              placeholder="İplik seç"
              disabled={!canWrite}
            />
            <Input aria-label={`Atkı ${weftLetter(i)} rapordaki atkı adedi`} value={r.picks} inputMode="numeric" disabled={!canWrite || derived} title={derived ? "Sıra kodundan sunucu türetir" : undefined}
              placeholder={derived ? "sıradan hesaplanır" : "ör. 4"} onChange={(e) => setRow(i, { picks: e.target.value })} />
            {rowExtra?.(i)}
            {canWrite && (
              <Button type="button" variant="ghost" size="icon" aria-label={`Atkı ${weftLetter(i)} satırını sil`} onClick={() => set({ rows: rows.filter((_, j) => j !== i) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <Button type="button" variant="outline" size="sm" disabled={rows.length >= MAX_WEFT_LINES} onClick={() => set({ rows: [...rows, { yarnItemId: "", picks: "" }] })}>
          Atkı ipliği ekle
        </Button>
      )}
    </div>
  );
}

// Sıra kodunun kutu şeridi: kod alanıyla iki yönlü; kaydedilen değer koddur (sunucu açar ve doğrular).
function WeftBoxSection({ seq, saved, letterCount, canWrite, onChange }: {
  seq: string; saved: string; letterCount: number; canWrite: boolean; onChange: (c: string) => void;
}) {
  // Kaydedilmemiş sıra kodu sekmeyi kirli yapar (kapatırken onay sorulur).
  useDirtyTab(seq.trim() !== saved.trim());
  if (!canWrite && seq.trim() === "") return null;
  return (
    <section className="space-y-1.5" aria-label="Atkı sırası kutuları">
      <h4 className="flex items-center gap-1 text-sm font-medium">
        Atkı sırası
        <InfoPopover label="Atkı sırası kutuları" desc={BOX_INFO} />
      </h4>
      <SequenceBoxEditor value={seq} onChange={onChange} letterCount={letterCount} defaultStyle="letter-first" unit="atkı"
        label="Atkı sırası kutuları" disabled={!canWrite} />
    </section>
  );
}

const SEQ_INFO = "Harf = atkı ipliği satırı (A = 1. satır), sayı = arka arkaya kaç atkı atıldığı: ör. A4 B1 A4 C1. "
  + "Tekrar eden kısmı parantezle kısaltabilirsiniz: 10x(A2 B2 C1) D4 = parantez içi 10 kez, ardından 4 atkı D (54 atkı).";

const PICKS_INFO = "Desenin bir tekrarında (raporunda) bu iplikle kaç atkı atıldığı. Ör. sıra A4 B1 ise A ipliği 4, B ipliği 1. "
  + "Atkı sırası kodu girilmişse bu sayı sıradan kendiliğinden hesaplanır. İpliklerin kumaştaki payı bu sayılardan bulunur.";

/** İplik satırlarının sütun başlıkları — "adet" kutusunun ne olduğunu söyler (ⓘ). `extra` verilirse (pay %) bir sütun daha. */
export function WeftRowsHeader({ extra }: { extra?: string }) {
  const grid = extra ? "sm:grid-cols-[2rem_1fr_8rem_4.5rem_2.5rem]" : "sm:grid-cols-[2rem_1fr_8rem_2.5rem]";
  return (
    <div className={`hidden gap-2 text-xs text-muted-foreground sm:grid ${grid}`}>
      <span />
      <span>Atkı ipliği</span>
      {/* 8rem sütunda uzun başlık 1440'ta iki satıra kırılıyordu: kısa etiket, tam anlam ⓘ'de. */}
      <span className="flex items-center gap-1 whitespace-nowrap">Atış adedi<InfoPopover label="Rapordaki atkı adedi" desc={PICKS_INFO} /></span>
      {extra && <span className="text-right">{extra}</span>}
      <span />
    </div>
  );
}

const BOX_INFO ="Her kutu bir atkıdır; rengi ve harfi o atkıda atılan ipliktir (A = 1. iplik satırı). Kutuya tıklamak ipliği sıradakine çevirir; "
  + "seçili kutu harf düğmeleriyle ya da klavyeden harf tuşuyla değişir, Delete siler, + sonrasına ekler. Kutular yukarıdaki sıra kodunu "
  + "yazar, kod değişince kutular da değişir. Kaydedince atkı seçici sunucudan yeniden çizilir.";
