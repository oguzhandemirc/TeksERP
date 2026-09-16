// =============================================================================
// MAL KABUL SATIR EDİTÖRÜ
// =============================================================================
// Saha isteği (2026-08-13): "patos gri 250 cm 500 metre kumaştan 20 tane geldi"
// tek satırda yazılabilmeli; benzer bir satırdan yalnız bir alanı değiştirmek
// için KOPYALA olmalı.
//
// ⚠️ ADET bir TOP ÖZELLİĞİ DEĞİLDİR, bir GİRİŞ KOLAYLIĞIDIR: kaydederken N ayrı
// TOP doğar (her biri kendi barkodu + kendi metresiyle). Modelde "20 adetlik
// top" diye bir şey yok ve olmamalı — envanterin birimi TOPTUR; aksi halde
// kesim/sevk/iade gibi her akış "kaç adedi kaldı" sorusunu yeniden icat ederdi.
// Bu yüzden çarpan yalnız bu formda yaşar, backend'e N satır olarak gider.
//
// İPLİK SATIRI (Sınıf 5, 2026-08-14): kalem türü YARN ise satır `Roll` değil
// `YarnMovement` doğurur — miktar KG'dir ve renk/en/kg/kat/özellik hücreleri
// devre dışı "—" çizilir (backend `addYarnLine` bu alanları 400 ile reddeder;
// operatör kuralı deneme-yanılmayla değil ekrandan öğrenir). Birim Fiyat
// iplikte de SERBESTTİR (`yarn_movements.unitPrice`, migration 20260814).
// Adet iplikte de çalışır: N × qtyKg = N ayrı defter satırı (toplam doğru).
// =============================================================================
import { useEffect } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { useFoldValues } from "@/hooks/useFoldValues";
import type { Item } from "@/pages/Items/types";
import type { Color } from "@/pages/Colors/types";
import { LinePropertiesButton } from "./LinePropertiesButton";
import { cellLabel, receiptLineGridCols, receiptLineHeaders, receiptLineMode, visibleColumnIndexes } from "./receiptLineColumns";

export interface DraftLine {
  key: string;
  itemId: string;
  colorId: string | null;
  /** TOP BAŞINA metre (adetle çarpılmaz — her top bu metrede doğar). */
  initialQty: number;
  width: number | null;
  weightKg: number | null;
  foldType: string | null;
  /** Satın alma birim fiyatı (fişin para biriminde) — opsiyonel. */
  unitPrice: number | null;
  /** Üretim özellikleri (FabricProperty id'leri) — opsiyonel. */
  propertyIds: string[];
  /** Kaç TOP gelmiş — kaydederken bu sayıda ayrı top doğar. */
  count: number;
  /** İPLİK satırı: tedarikçi lot numarası (irsaliyedeki metin, olduğu gibi; opsiyonel — devere Faz 2). */
  lotNo?: string | null;
  /** İPLİK satırı: bobin adedi (bilgi; opsiyonel). */
  bobbinCount?: number | null;
}

export function emptyLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    itemId: "",
    colorId: null,
    initialQty: 0,
    width: null,
    weightKg: null,
    foldType: null,
    unitPrice: null,
    propertyIds: [],
    count: 1,
    lotNo: null,
    bobbinCount: null,
  };
}

/** Satırı kopyalar — YENİ anahtarla (idempotency token'ı da yeniden doğar). */
export function duplicateLine(l: DraftLine): DraftLine {
  return { ...l, key: crypto.randomUUID() };
}

interface Props {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  /** İPLİK kalem id'leri (`useItemTypes` + `yarnIdsFrom`) — verilmezse tüm
   *  satırlar kumaş sayılır (eski davranış bayt-bayt korunur). */
  yarnItemIds?: ReadonlySet<string>;
}

/** İplik satırının TAŞIYAMAYACAĞI alanlar dolu mu? (backend 400 kümesinin aynası) */
function hasYarnStrays(l: DraftLine): boolean {
  return Boolean(l.colorId) || l.width != null || l.weightKg != null || Boolean(l.foldType) || l.propertyIds.length > 0;
}

/** Kumaşa özgü alanları temizlenmiş kopya — iplik satırına geçişte uygulanır. */
function clearYarnStrays(l: DraftLine): DraftLine {
  return { ...l, colorId: null, width: null, weightKg: null, foldType: null, propertyIds: [] };
}

export function ReceiptLineRows({ lines, onChange, yarnItemIds }: Props) {
  const { values: foldValues } = useFoldValues();
  const isYarn = (itemId: string) => Boolean(itemId && yarnItemIds?.has(itemId));

  // ⚠️ İPLİĞE GEÇEN SATIRIN KUMAŞ ALANLARI SIFIRLANIR (rota editörünün
  // "istasyon değişince hedef sıfırlanır" kuralının ikizi): kumaş seçiliyken
  // girilen renk/en/kg/kat/özellik, kalem ipliğe çevrilince SESSİZCE
  // gönderilirse backend 400 verir — hem de hiç dokunulmamış görünen bir
  // alandan. Effect olarak yazıldı (patch anında değil) çünkü tür lookup'ı
  // asenkron çözülür ve satırlar üç kapıdan girer (elle seçim · Excel import ·
  // siparişten doldur) — üçünü de tek nokta kapsar.
  useEffect(() => {
    if (!yarnItemIds || yarnItemIds.size === 0) return;
    if (!lines.some((l) => isYarn(l.itemId) && hasYarnStrays(l))) return;
    onChange(lines.map((l) => (isYarn(l.itemId) && hasYarnStrays(l) ? clearYarnStrays(l) : l)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, yarnItemIds]);

  const patch = (key: string, p: Partial<DraftLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));

  /** Karma tabloda iplik satırının kumaşa özgü hücresi — BOŞ (tire yok; kullanıcı C1: "iki kilo alanı");
   *  etiket/ipucu başlığın anlamını taşır ("Kg — iplikte miktar zaten kg"). Yalnız-iplik tabloda bu
   *  sütunlar HİÇ çizilmez. */
  const blank = (label: string) => <span title={label} aria-label={label} role="note" className="h-9" />;

  // Üç mod (`receiptLineColumns.ts`, başlık ↔ hücre tek tablo): yalnız kumaş → eski başlık bayt bayt;
  // yalnız iplik → iplik dili, Kg/Kat/Özellik sütunları yok; karma → iki türü anlatan başlık.
  const mode = receiptLineMode(lines.some((l) => l.itemId && !isYarn(l.itemId)), lines.some((l) => isYarn(l.itemId)));
  const cols = receiptLineGridCols(mode);
  const headers = receiptLineHeaders(mode);
  const show = new Set(visibleColumnIndexes(mode));

  return (
    <div className="rounded-md border">
      <div className={`grid ${cols} gap-2 border-b bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground`} data-testid="receipt-line-headers" data-mode={mode}>
        {headers.map((h) => (
          <span key={h} className={h === "Özellik" || h === "Adet" ? "text-center" : undefined}>{h}</span>
        ))}
        <span />
      </div>

      <div className="max-h-[38vh] space-y-2 overflow-auto p-3">
        {lines.map((l) => {
          const yarn = isYarn(l.itemId);
          return (
          <div key={l.key} className={`grid ${cols} items-center gap-2`} data-testid={yarn ? "receipt-line-yarn" : "receipt-line-fabric"}>
            <ReferenceSelect<Item>
              value={l.itemId || null}
              onChange={(v) => patch(l.key, { itemId: v ?? "" })}
              service={itemService}
              queryKey="items"
              getLabel={(it) => `${it.code} — ${it.name}`}
              placeholder="Kumaş / iplik ara..."
              aria-label={cellLabel(0, yarn)}
            />
            {/* İPLİK: kumaşa özgü hücreler devre dışı "—" — backend'in 400'le
                reddettiği alanlar hiç sorulmasın (400'e düşmeden öğret). */}
            {/* İPLİK: renk yerine LOT — irsaliyedeki lot numarası olduğu gibi (ayrıştırılmaz);
                boş bırakılabilir, "lot zorunlu" ayarı açıksa sunucu satırı sebebiyle düşürür. */}
            {yarn ? (
              <Input
                placeholder="Lot no (irsaliye)"
                maxLength={64}
                aria-label={cellLabel(1, true)}
                value={l.lotNo ?? ""}
                onChange={(e) => patch(l.key, { lotNo: e.target.value || null })}
              />
            ) : (
              <ReferenceSelect<Color>
                value={l.colorId}
                onChange={(v) => patch(l.key, { colorId: v })}
                service={colorService}
                queryKey="colors"
                getLabel={(c) => c.name}
                placeholder="Renk..."
                aria-label={cellLabel(1, false)}
              />
            )}
            {/* Miktar: iplikte KG'dir — kutunun içine "kg" rozeti girer; başlık iplik varken
                "Miktar (m / kg)" olur (kumaş-only tabloda "Metre"). */}
            <div className="relative">
              <Input
                type="number" min={0} step="0.01" placeholder="0"
                aria-label={cellLabel(2, yarn)}
                className={yarn ? "pr-7" : undefined}
                value={l.initialQty || ""}
                onChange={(e) => patch(l.key, { initialQty: Number(e.target.value) })}
              />
              {yarn && (
                <span
                  title="İplikte miktar KG'dir"
                  className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] font-semibold uppercase text-muted-foreground"
                >
                  kg
                </span>
              )}
            </div>
            {yarn ? (
              <Input
                type="number" min={1} step={1} placeholder="—"
                aria-label={cellLabel(3, true)}
                title="Bobin adedi (bilgi — bakiye değil)"
                value={l.bobbinCount ?? ""}
                onChange={(e) => patch(l.key, { bobbinCount: e.target.value ? Math.max(1, Math.trunc(Number(e.target.value))) : null })}
              />
            ) : (
              <Input
                type="number" min={0} placeholder="—"
                aria-label={cellLabel(3, false)}
                value={l.width ?? ""}
                onChange={(e) => patch(l.key, { width: e.target.value ? Number(e.target.value) : null })}
              />
            )}
            {/* İplikte AYRI kg alanı yok — miktar zaten kg (backend, çelişen
                weightKg'yi 400 ile reddeder; hücre hiç sorulmaz). */}
            {!show.has(4) ? null : yarn ? (
              blank(cellLabel(4, true))
            ) : (
              <Input
                type="number" min={0} step="0.01" placeholder="—"
                aria-label={cellLabel(4, false)}
                value={l.weightKg ?? ""}
                onChange={(e) => patch(l.key, { weightKg: e.target.value ? Number(e.target.value) : null })}
              />
            )}
            {/* KAT opsiyonel ve KATALOGDAN gelir — sabit liste, panelden eklenen
                6-KAT'ı görünmez yapardı; boş katalogda seçici hiç çizilmez. */}
            {!show.has(5) ? null : yarn ? (
              blank(cellLabel(5, true))
            ) : foldValues.length > 0 ? (
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                aria-label={cellLabel(5, false)}
                value={l.foldType ?? ""}
                onChange={(e) => patch(l.key, { foldType: e.target.value || null })}
              >
                <option value="">—</option>
                {foldValues.map((f) => (
                  <option key={f.code} value={f.code}>{f.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-center text-xs text-muted-foreground" aria-label={cellLabel(5, false)} title="Kat kataloğu boş">—</span>
            )}
            {/* Alış fiyatı OPSİYONEL ve İPLİKTE DE SERBEST (yarn_movements.unitPrice,
                Sınıf 5): girilirse satıra yazılır ve alış faturası fiyatı ondan
                türer; boşsa fatura fiyatsız taslak doğar (onay fiyatsızı reddediyor). */}
            <Input
              type="number" min={0} step="0.0001" placeholder="—"
              aria-label={cellLabel(6, yarn)}
              value={l.unitPrice ?? ""}
              onChange={(e) => patch(l.key, { unitPrice: e.target.value ? Number(e.target.value) : null })}
            />
            {!show.has(7) ? null : yarn ? (
              blank(cellLabel(7, true))
            ) : (
              <LinePropertiesButton
                aria-label={cellLabel(7, false)}
                itemId={l.itemId}
                value={l.propertyIds}
                onChange={(v) => patch(l.key, { propertyIds: v })}
              />
            )}
            {/* ADET iplikte de anlamlı: N ayrı defter satırı (kg × adet) — dosya başlığındaki Sınıf 5
                kuralı; title başlıkla aynı anlamı taşır. */}
            <Input
              type="number" min={1} step="1"
              className="text-center font-medium"
              aria-label={cellLabel(8, yarn)}
              title={yarn ? "Kaç ayrı iplik defter satırı doğsun (her biri bu kg'de)" : "Kaç top doğsun (her biri bu metrede)"}
              value={l.count}
              onChange={(e) => patch(l.key, { count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            />
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost" size="icon" title="Satırı kopyala"
                onClick={() => onChange([...lines, duplicateLine(l)])}
              >
                <Copy className="h-4 w-4" />
              </Button>
              {/* Silme YIKICI bir eylem — kırmızı zemin + beyaz ikon (saha isteği:
                  "tehlikeli olduğu belli olsun"). Tek satır kalınca kapalı. */}
              <Button
                size="icon"
                title="Satırı sil"
                className="bg-destructive text-white hover:bg-destructive/90 disabled:opacity-40"
                disabled={lines.length === 1}
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

export interface ReceiptDraftTotals {
  /** Doğacak TOP sayısı (kumaş satırları × adet). */
  rolls: number;
  /** Kumaş metrajı toplamı. ⚠️ İplik kg'si BUNA EKLENMEZ — m ↔ kg toplanmaz
   *  (backend `ReceiptTotals` sözleşmesinin aynası). */
  meters: number;
  /** Doğacak İPLİK defter satırı sayısı (iplik satırları × adet). */
  yarnLines: number;
  /** İplik kg toplamı (kg × adet). */
  yarnKg: number;
  /** Para toplamı — kumaş + iplik BİRLİKTE (ikisi de fişin para biriminde). */
  amount: number;
}

/** Formun canlı özeti — kaç TOP, kaç metre, kaç kg iplik, kaç para.
 *  `yarnItemIds` verilmezse tüm satırlar kumaş sayılır (eski davranış). */
export function receiptTotals(lines: DraftLine[], yarnItemIds?: ReadonlySet<string>): ReceiptDraftTotals {
  const valid = lines.filter((l) => l.itemId && l.initialQty > 0 && l.count > 0);
  const fabric = valid.filter((l) => !yarnItemIds?.has(l.itemId));
  const yarn = valid.filter((l) => yarnItemIds?.has(l.itemId));
  return {
    rolls: fabric.reduce((s, l) => s + l.count, 0),
    meters: fabric.reduce((s, l) => s + l.initialQty * l.count, 0),
    yarnLines: yarn.reduce((s, l) => s + l.count, 0),
    yarnKg: yarn.reduce((s, l) => s + l.initialQty * l.count, 0),
    // Fiyat girilmemiş satır tutara 0 katkı verir — "eksik fiyat" uyarısı
    // BİLİNÇLİ olarak yok: fiyat opsiyoneldir ve fatura onayı zaten fiyatsızı
    // reddediyor (uyarıyı iki yerde tekrarlamak gürültüdür).
    amount: valid.reduce((s, l) => s + (l.unitPrice ?? 0) * l.initialQty * l.count, 0),
  };
}

/** Taslak satırları backend sözleşmesine açar: 1 satır × adet = N top (kumaş)
 *  ya da N iplik defter satırı.
 *
 *  ⚠️ İPLİK SATIRI KUMAŞA ÖZGÜ ALANLARI HİÇ GÖNDERMEZ (ikinci hat — birinci
 *  hat ekrandaki devre dışı hücreler + temizleme effect'idir): backend
 *  `addYarnLine` renk/en/kg/kat/özellik taşıyan iplik satırını 400 ile
 *  reddeder; buradan sızan bayat bir değer operatörün hiç görmediği bir
 *  alandan hata üretirdi. */
export function expandLines(lines: DraftLine[], yarnItemIds?: ReadonlySet<string>) {
  return lines
    .filter((l) => l.itemId && l.initialQty > 0 && l.count > 0)
    .flatMap((l) => {
      const yarn = yarnItemIds?.has(l.itemId) ?? false;
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
              // Her TOP kendi idempotency anahtarını taşır (backend uuid bekler).
              // Asıl koruma FİŞ seviyesindedir — aynı `clientToken` ile ikinci POST
              // mevcut fişi döner ve satırları TEKRAR İŞLEMEZ; bu ikinci hattır.
              clientToken: crypto.randomUUID(),
            },
      );
    });
}
