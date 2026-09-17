// =============================================================================
// MAL KABUL SATIR EDİTÖRÜ — TÜRE GÖRE İKİ ALT TABLO (EK 5, kullanıcı onayı 2026-09-17)
// =============================================================================
// Saha isteği (2026-08-13): "patos gri 250 cm 500 metre kumaştan 20 tane geldi" tek satırda yazılabilmeli; benzer
// satırdan bir alanı değiştirmek için KOPYALA olmalı. ⚠️ ADET bir TOP ÖZELLİĞİ DEĞİLDİR, GİRİŞ KOLAYLIĞIDIR:
// kaydederken N ayrı TOP doğar (her biri kendi barkodu + metresiyle); çarpan yalnız bu formda yaşar.
//
// İPLİK SATIRI (Sınıf 5, 2026-08-14): kalem türü YARN ise satır `Roll` değil `YarnMovement` doğurur — miktar KG'dir;
// renk/en/kg/kat/özellik/top sınıfı iplikte YOK (backend 400 ile reddeder). Birim Fiyat iplikte de serbest.
//
// EK 5: karma tek ızgara ve çift anlamlı başlıklar GİTTİ — aynı fişte KUMAŞ kalemleri ve İPLİK kalemleri ayrı alt
// tablo; boş grup çizilmez; her grubun kendi "… satırı ekle" düğmesi (ürün seçici o türe kilitli: satır doğduğu anda
// tiplidir, tür değiştirmek = satırı silmek). Siparişten doldurma ve Excel satırları ürün türüne göre gruba düşer
// (`useItemTypes` → `lineKind`). EK 7: top sınıfı SATIR BAZLI ve ÜÇLÜ (Ham · Yarı mamul · Bitmiş) — fiş kutusu KALKTI,
// yeni kumaş satırı bir önceki kumaş satırının sınıfını miras alır (ilk satır bitmiş).
// =============================================================================
import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFoldValues } from "@/hooks/useFoldValues";
import { ReceiptFabricRow } from "./ReceiptFabricRow";
import { ReceiptYarnRow } from "./ReceiptYarnRow";
import { ADD_LINE_LABEL, GROUP_TITLE, receiptLineGridCols, receiptLineHeaders, type ReceiptLineKind } from "./receiptLineColumns";
import { DEFAULT_LINE_CLASS, duplicateLine, emptyLine, inheritedLineClass, lineKind, type DraftLine } from "./receiptLineTypes";

export { emptyLine, duplicateLine, lineKind, inheritedLineClass, type DraftLine, type ReceiptLineClass } from "./receiptLineTypes";

interface Props {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  /** İPLİK kalem id'leri (`useItemTypes` + `yarnIdsFrom`) — verilmezse satırın doğduğu grup / kumaş (eski davranış). */
  yarnItemIds?: ReadonlySet<string>;
  /** C8: satır anahtarı → hata metni (yerel lot doğrulaması ya da sunucu 400 `details.lines`). */
  lineIssues?: ReadonlyMap<string, string>;
}

/** İplik satırının TAŞIYAMAYACAĞI alanlar dolu mu? (backend 400 kümesinin aynası) */
function hasYarnStrays(l: DraftLine): boolean {
  return Boolean(l.colorId) || l.width != null || l.weightKg != null || Boolean(l.foldType) || l.propertyIds.length > 0 || l.lineClass != null;
}

/** Kumaşa özgü alanları temizlenmiş kopya — iplik satırına geçişte uygulanır. */
function clearYarnStrays(l: DraftLine): DraftLine {
  return { ...l, colorId: null, width: null, weightKg: null, foldType: null, propertyIds: [], lineClass: undefined };
}

function GroupHeader({ kind }: { kind: ReceiptLineKind }) {
  const headers = receiptLineHeaders(kind);
  return (
    <div className={`grid ${receiptLineGridCols(kind)} gap-2 border-b bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground`} data-testid={`receipt-line-headers-${kind}`}>
      {headers.map((h, i) => (
        <span key={i} className={h === "Özellik" || h === "Adet" || h === "Ham/Bitmiş" ? "text-center" : undefined}>{h}</span>
      ))}
      <span />
    </div>
  );
}

export function ReceiptLineRows({ lines, onChange, yarnItemIds, lineIssues }: Props) {
  const { values: foldValues } = useFoldValues();

  // ⚠️ İPLİĞE GEÇEN SATIRIN KUMAŞ ALANLARI SIFIRLANIR (rota editörünün "istasyon değişince hedef sıfırlanır" kuralının
  // ikizi): kumaş alanları iplik satırından SESSİZCE giderse backend 400 verir. Effect (patch anında değil): tür lookup'ı
  // asenkron çözülür ve satırlar üç kapıdan girer (elle · Excel · siparişten) — üçünü tek nokta kapsar.
  useEffect(() => {
    if (!yarnItemIds || yarnItemIds.size === 0) return;
    const isYarnLine = (l: DraftLine) => lineKind(l, yarnItemIds) === "YARN";
    if (!lines.some((l) => isYarnLine(l) && hasYarnStrays(l))) return;
    onChange(lines.map((l) => (isYarnLine(l) && hasYarnStrays(l) ? clearYarnStrays(l) : l)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, yarnItemIds]);

  const patch = (key: string, p: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const groups: Record<ReceiptLineKind, DraftLine[]> = { FABRIC: [], YARN: [] };
  for (const l of lines) groups[lineKind(l, yarnItemIds)].push(l);
  const rowProps = (l: DraftLine) => ({
    line: l,
    onPatch: (p: Partial<DraftLine>) => patch(l.key, p),
    onDuplicate: () => onChange([...lines, duplicateLine(l)]),
    onRemove: () => onChange(lines.filter((x) => x.key !== l.key)),
    // Tek satır kalınca kapalı: backend en az bir satır ister; boş formu kaydettirmek 400'e yürütmek olurdu.
    removeDisabled: lines.length === 1,
  });

  return (
    <div className="space-y-3">
      {(["FABRIC", "YARN"] as const).map((kind) =>
        groups[kind].length === 0 ? null : (
          <section key={kind} className="rounded-md border" data-testid={`receipt-group-${kind}`} aria-label={GROUP_TITLE[kind]}>
            <h4 className="border-b px-3 py-1.5 text-xs font-semibold">{GROUP_TITLE[kind]}</h4>
            <GroupHeader kind={kind} />
            <div className="max-h-[32vh] space-y-2 overflow-auto p-3">
              {groups[kind].map((l) =>
                kind === "YARN" ? (
                  <ReceiptYarnRow key={l.key} {...rowProps(l)} issue={lineIssues?.get(l.key)} />
                ) : (
                  <ReceiptFabricRow key={l.key} {...rowProps(l)} foldValues={foldValues} />
                ),
              )}
            </div>
          </section>
        ),
      )}
      {/* Grup düğmeleri: satır DOĞDUĞU ANDA tiplidir (kumaş satırı → kumaş seçici; iplik satırı → iplik seçici);
          yeni kumaş satırı sınıfını bir önceki kumaş satırından devralır (EK 7). */}
      <div className="flex flex-wrap gap-2">
        {(["FABRIC", "YARN"] as const).map((kind) => (
          <Button key={kind} type="button" variant="ghost" size="sm" onClick={() => onChange([...lines, emptyLine(kind, inheritedLineClass(lines, yarnItemIds))])}>
            <Plus className="mr-1 h-4 w-4" />
            {ADD_LINE_LABEL[kind]}
          </Button>
        ))}
      </div>
    </div>
  );
}

export interface ReceiptDraftTotals {
  /** Doğacak TOP sayısı (kumaş satırları × adet). */
  rolls: number;
  /** Kumaş metrajı toplamı. ⚠️ İplik kg'si BUNA EKLENMEZ — m ↔ kg toplanmaz (backend `ReceiptTotals` aynası). */
  meters: number;
  /** Doğacak İPLİK defter satırı sayısı (iplik satırları × adet). */
  yarnLines: number;
  /** İplik kg toplamı (kg × adet). */
  yarnKg: number;
  /** Para toplamı — kumaş + iplik BİRLİKTE (ikisi de fişin para biriminde). */
  amount: number;
}

/** Formun canlı özeti — kaç TOP, kaç metre, kaç kg iplik, kaç para. `yarnItemIds` verilmezse satırın grubu/kumaş. */
export function receiptTotals(lines: DraftLine[], yarnItemIds?: ReadonlySet<string>): ReceiptDraftTotals {
  const valid = lines.filter((l) => l.itemId && l.initialQty > 0 && l.count > 0);
  const fabric = valid.filter((l) => lineKind(l, yarnItemIds) !== "YARN");
  const yarn = valid.filter((l) => lineKind(l, yarnItemIds) === "YARN");
  return {
    rolls: fabric.reduce((s, l) => s + l.count, 0),
    meters: fabric.reduce((s, l) => s + l.initialQty * l.count, 0),
    yarnLines: yarn.reduce((s, l) => s + l.count, 0),
    yarnKg: yarn.reduce((s, l) => s + l.initialQty * l.count, 0),
    // Fiyat girilmemiş satır tutara 0 katkı verir — "eksik fiyat" uyarısı BİLİNÇLİ olarak yok: fiyat opsiyoneldir ve
    // fatura onayı zaten fiyatsızı reddediyor.
    amount: valid.reduce((s, l) => s + (l.unitPrice ?? 0) * l.initialQty * l.count, 0),
  };
}

/** Taslak satırları → backend gövdesi. Adet N → N ayrı satır. İplik satırı kumaşa özgü anahtarları HİÇ taşımaz
 *  (backend `addYarnLine` 400 ile reddeder); kumaş satırı `lineClass`ı HER ZAMAN taşır (fiş kutusu yok — satır tek yer). */
export function expandLines(lines: DraftLine[], yarnItemIds?: ReadonlySet<string>) {
  return lines
    .filter((l) => l.itemId && l.initialQty > 0 && l.count > 0)
    .flatMap((l) => {
      const yarn = lineKind(l, yarnItemIds) === "YARN";
      return Array.from({ length: l.count }, () =>
        yarn
          ? {
              itemId: l.itemId,
              initialQty: l.initialQty, // iplikte KG
              unitPrice: l.unitPrice,
              // Devere Faz 2: lot + bobin yalnız iplik satırında (Zod bilinmeyeni sessizce atar — iki uçta da beyanlı).
              lotNo: l.lotNo?.trim() ? l.lotNo.trim() : null,
              bobbinCount: l.bobbinCount ?? null,
              clientToken: crypto.randomUUID(),
            }
          : {
              itemId: l.itemId,
              colorId: l.colorId,
              initialQty: l.initialQty,
              width: l.width,
              weightKg: l.weightKg,
              foldType: l.foldType,
              unitPrice: l.unitPrice,
              propertyIds: l.propertyIds.length > 0 ? l.propertyIds : undefined,
              lineClass: l.lineClass ?? DEFAULT_LINE_CLASS,
              // Her TOP kendi idempotency anahtarını taşır (backend uuid bekler). Asıl koruma FİŞ seviyesindedir.
              clientToken: crypto.randomUUID(),
            },
      );
    });
}
