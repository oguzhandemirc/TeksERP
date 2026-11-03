// Gelen belge → kayıt kipi seçenekleri (Gülkesim parti/metre §2.1; tek yazar `PUT /api/gelen-belge/ayarlar`):
//   · parti numarası kaynağı — seriden (varsayılan, bugünkü) | belgedeki parti no'dan
//   · onay kipi — her satır bir top (varsayılan, bugünkü) | belge başına tek kayıt (kurşun metresiyle tek top)
//   · işlem değeri çözülemeyen grupta otomatik iş emri — atla (varsayılan, bugünkü) | hedef değersiz aç
//   · iş emri formundan okutulan belge — ayrı onay (varsayılan, bugünkü) | iş emri açan kaydeder (K7) · refakat oto baskı (K9)
//   · istasyonda belge okutarak iş emri bulma (K17; varsayılan kapalı = tablette düğme yok)
//   · belge fotoğrafı saklama (K28; varsayılan tam = bugünkü; geçmiş onaylı belgelere de uygulanır)
// Eski backend alanı göndermez → alan çizilmez, gövdeye girmez. Kip kuralı istemciye kopyalanmaz: tek kayıt kipinin
// varsayılan ürün ön koşulunu sunucu 400 ile söyler; burada yalnız önceden görünür bir uyarı var.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { FieldLabel, FlagToggle } from "./SettingRow";
import { EnumRadioOptions } from "./EnumRadioOptions";
import { TERIM } from "@/lib/terim";
import type { AutoWorkOrderPatternlessMode, BatchNumberSourceMode, IncomingDocEntryMode, IncomingDocFormApproval, IncomingDocumentSettings } from "@/pages/Operations/GelenBelgeler/types";
import type { PhotoRetentionMode } from "@/pages/Operations/GelenBelgeler/photoRetentionTypes";
import type { MultiPartyWorkOrderMode } from "@/pages/Operations/GelenBelgeler/partiMetreTypes";


type Option<T extends string> = { value: T; label: string; hint: string };

export const BATCH_NUMBER_SOURCE_OPTIONS: ReadonlyArray<Option<BatchNumberSourceMode>> = [
  { value: "SERIES", label: "Numara serisinden", hint: "Parti numarası fabrikanın parti serisinden verilir (bugünkü davranış)." },
  { value: "DOCUMENT", label: "Belgedeki parti no", hint: "Taslakta seçilen parti no (barkod no, parti no, evrak no…) partinin adı olur; belgede numara yoksa seriden verilir." },
];

export const ENTRY_MODE_OPTIONS: ReadonlyArray<Option<IncomingDocEntryMode>> = [
  { value: "PER_LINE", label: "Her satır bir top", hint: "Belgedeki her satır onayda ayrı top olur (bugünkü davranış)." },
  { value: "PER_DOCUMENT", label: "Belge başına tek kayıt", hint: "Onayda belge başına tek top açılır; miktarı belgenin kurşun metresidir (çıkış metresi → toplam metre → satır toplamı). Satırlar bilgi olarak kalır. Varsayılan ürün seçili olmalı." },
];

export const AUTO_WORK_ORDER_PATTERNLESS_OPTIONS: ReadonlyArray<Option<AutoWorkOrderPatternlessMode>> = [
  { value: "SKIP", label: "Atla", get hint() { return `İşlem değeri (desen/gramaj) çözülemeyen grup için ${TERIM.terbiyeIsEmri.tekilKucuk} açılmaz; onay sonucu elle açılmasını söyler (bugünkü davranış).`; } },
  { value: "OPEN", label: "Hedef değersiz aç", get hint() { return `İşlem değeri çözülemeyen grup için de ${TERIM.terbiyeIsEmri.tekilKucuk} açılır; hedef değer boş kalır.`; } },
];

export const FORM_APPROVAL_OPTIONS: ReadonlyArray<Option<IncomingDocFormApproval>> = [
  { value: "SEPARATE", label: "Ayrı onay", get hint() { return `${TERIM.terbiyeIsEmri.tekil} formundan okutulan belge taslak kalır; Gelen Belgeler'den onaylanınca ${TERIM.terbiyeIsEmri.tekilKucuk} açılır (bugünkü davranış).`; } },
  { value: "WITH_WORK_ORDER", get label() { return `${TERIM.terbiyeIsEmri.tekil} ile birlikte`; }, get hint() { return `Formdan okutulan belgeyi ${TERIM.terbiyeIsEmri.tekilKucuk} açma izni olan kaydeder: belge, müşteri malı top ve ${TERIM.terbiyeIsEmri.tekilKucuk} tek seferde açılır; ayrı onay adımı yok.`; } },
];

export const MULTI_PARTY_OPTIONS: ReadonlyArray<Option<MultiPartyWorkOrderMode>> = [
  { value: "SINGLE", get label() { return `Tek ${TERIM.terbiyeIsEmri.tekilKucuk}`; }, get hint() { return `Belgedeki partiler ayrı top olarak tek ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} girer (bugünkü davranış).`; } },
  { value: "PER_PARTY", get label() { return `Her parti ayrı ${TERIM.terbiyeIsEmri.tekilKucuk}`; }, get hint() { return `Çok partili belgede (çeki listesinde birden çok parti) her parti kendi ${TERIM.terbiyeIsEmri.cekimKucuk.belirtme} açar; parti no belgeden.`; } },
];

export const PHOTO_RETENTION_OPTIONS: ReadonlyArray<Option<PhotoRetentionMode>> = [
  { value: "FULL", label: "Tam sakla", hint: "Belge fotoğrafı olduğu gibi saklanır (bugünkü davranış)." },
  { value: "SHRINK_ON_APPROVAL", label: "Onayda küçült", hint: "Onaydan sonra fotoğraf okunur boyda (~200 KB) saklanır; okuma servisi kapalıysa fotoğraf tam kalır, servis açılınca küçültülür." },
  { value: "DELETE_ON_APPROVAL", label: "Onayda sil", hint: "Onaydan sonra fotoğraf silinir; belge, satırlar ve okuma sonucu kalır. Fotoğraf açılmaz, yeniden okunamaz, tanıtılamaz." },
  { value: "DELETE_ON_DISPATCH", label: "Sevkte sil", hint: "Belgenin bütün topları sevk edilince fotoğraf silinir; o zamana kadar tam saklanır." },
];

type Pair<T extends string> = { server: T | undefined; value: T | undefined; set: (v: T) => void; fallback: T | undefined; dirty: boolean };

function usePair<T extends string>(server: T | undefined, fallback: T | undefined): Pair<T> {
  const [value, setValue] = useState<T | undefined>(server);
  return { server, value, set: setValue, fallback, dirty: server !== undefined && value !== undefined && value !== server };
}

/** Kayıt kipi taslağı; sunucu alanı yoksa (eski backend) gövdeye girmez. */
export function useEntryModeDraft(server: IncomingDocumentSettings | undefined) {
  const batch = usePair(server?.batchNumberSource, server?.defaultBatchNumberSource);
  const entry = usePair(server?.entryMode, server?.defaultEntryMode);
  const patternless = usePair(server?.autoWorkOrderPatternless, server?.defaultAutoWorkOrderPatternless);
  const approval = usePair(server?.formApproval, server?.defaultFormApproval);
  const multiParty = usePair(server?.multiPartyWorkOrder, server?.defaultMultiPartyWorkOrder);
  const retention = usePair(server?.photoRetention, server?.defaultPhotoRetention);
  const serverPrint = server?.refakatAutoPrint;
  const [autoPrint, setAutoPrint] = useState<boolean | undefined>(serverPrint);
  const printDirty = serverPrint !== undefined && autoPrint !== undefined && autoPrint !== serverPrint;
  const serverLookup = server?.stationDocLookup;
  const [lookupOn, setLookupOn] = useState<boolean | undefined>(serverLookup);
  const lookupDirty = serverLookup !== undefined && lookupOn !== undefined && lookupOn !== serverLookup;
  const reset = () => {
    batch.set(batch.server as BatchNumberSourceMode); entry.set(entry.server as IncomingDocEntryMode); patternless.set(patternless.server as AutoWorkOrderPatternlessMode);
    approval.set(approval.server as IncomingDocFormApproval); multiParty.set(multiParty.server as MultiPartyWorkOrderMode); retention.set(retention.server as PhotoRetentionMode); setAutoPrint(serverPrint); setLookupOn(serverLookup);
  };
  const body = {
    ...(batch.dirty ? { batchNumberSource: batch.value } : {}),
    ...(entry.dirty ? { entryMode: entry.value } : {}),
    ...(patternless.dirty ? { autoWorkOrderPatternless: patternless.value } : {}),
    ...(approval.dirty ? { formApproval: approval.value } : {}),
    ...(multiParty.dirty ? { multiPartyWorkOrder: multiParty.value } : {}),
    ...(printDirty ? { refakatAutoPrint: autoPrint } : {}),
    ...(lookupDirty ? { stationDocLookup: lookupOn } : {}),
    ...(retention.dirty ? { photoRetention: retention.value } : {}),
  };
  const serverKey = `${batch.server ?? ""}|${entry.server ?? ""}|${patternless.server ?? ""}|${approval.server ?? ""}|${multiParty.server ?? ""}|${String(serverPrint ?? "")}|${String(serverLookup ?? "")}|${retention.server ?? ""}`;
  const print = { server: serverPrint, value: autoPrint, set: setAutoPrint };
  const lookup = { server: serverLookup, value: lookupOn, set: setLookupOn };
  return { batch, entry, patternless, approval, multiParty, retention, print, lookup, dirty: batch.dirty || entry.dirty || patternless.dirty || approval.dirty || multiParty.dirty || retention.dirty || printDirty || lookupDirty, body, reset, serverKey };
}

function EnumField<T extends string>({ id, label, desc, pair, options, children }: { id: string; label: string; desc: string; pair: Pair<T>; options: ReadonlyArray<Option<T>>; children?: React.ReactNode }) {
  if (pair.server === undefined) return null;
  const first = options[0]!.value;
  return (
    <div data-testid={id}>
      <FieldLabel htmlFor={`${id}-radios`} label={label} desc={desc} />
      <div id={`${id}-radios`} className="mt-2">
        <EnumRadioOptions name={label} value={pair.value ?? first} options={options} onChange={(v) => pair.set(v as T)} />
      </div>
      {children}
      <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {options.find((o) => o.value === (pair.fallback ?? first))?.label}</p>
    </div>
  );
}

/** `hasDefaultItem`: taslaktaki varsayılan ürün dolu mu (tek kayıt kipinin ön koşulu — kapı sunucuda). */
export function EntryModeFields({ draft, hasDefaultItem }: { draft: ReturnType<typeof useEntryModeDraft>; hasDefaultItem: boolean }) {
  return (
    <>
      <EnumField
        id="gb-entry-mode"
        label="Onay kipi"
        desc="Belge onaylanınca kaç kayıt açılsın. Fason kurşun gibi yalnız belgedeki toplam metrenin önemli olduğu işlerde belge başına tek kayıt seçilir; ürün, renk ve top sayısı önemsizleşir."
        pair={draft.entry}
        options={ENTRY_MODE_OPTIONS}
      >
        {draft.entry.value === "PER_DOCUMENT" && !hasDefaultItem && (
          <div role="alert" data-testid="gb-entry-mode-needs-item" className="mt-2 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Belge başına tek kayıt, yukarıdaki varsayılan ürünü ister; varsayılan ürün seçilmeden kaydedilemez.</span>
          </div>
        )}
      </EnumField>
      <EnumField
        id="gb-batch-number-source"
        label="Parti numarası"
        desc={`Belgeden açılan ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma}ki partinin numarası nereden gelsin. Belgeden alınırsa taslakta seçilen parti no kullanılır.`}
        pair={draft.batch}
        options={BATCH_NUMBER_SOURCE_OPTIONS}
      />
      <EnumField
        id="gb-auto-work-order-patternless"
        label={`Gramajı çözülemeyen grupta otomatik ${TERIM.terbiyeIsEmri.tekilKucuk}`}
        desc={`Onaydan sonra otomatik ${TERIM.terbiyeIsEmri.tekilKucuk} açılırken işlem değeri (desen/gramaj) belgeden çözülemeyen grup ne olsun. Otomatik ${TERIM.terbiyeIsEmri.tekilKucuk} kapalıysa etkisizdir.`}
        pair={draft.patternless}
        options={AUTO_WORK_ORDER_PATTERNLESS_OPTIONS}
      />
      <EnumField
        id="gb-form-approval"
        label={`${TERIM.terbiyeIsEmri.tekil} formundan okutulan belge`}
        desc={`${TERIM.terbiyeIsEmri.tekil} oluşturma ekranında okutulan belge nasıl kaydedilsin. "${TERIM.terbiyeIsEmri.tekil} ile birlikte" seçilirse ayrı onay (gelen-belge:approve) aranmaz; ${TERIM.terbiyeIsEmri.tekilKucuk} açma izni yeter.`}
        pair={draft.approval}
        options={FORM_APPROVAL_OPTIONS}
      />
      <EnumField
        id="gb-multi-party-work-order"
        label={`Çok partili belgeden ${TERIM.terbiyeIsEmri.tekilKucuk}`}
        desc={`Bir çeki listesinde birden çok parti varsa ${TERIM.terbiyeIsEmri.tekilKucuk} formunda varsayılan seçim. Form her belgede seçimi değiştirmeye izin verir.`}
        pair={draft.multiParty}
        options={MULTI_PARTY_OPTIONS}
      />
      {draft.print.server !== undefined && (
        <div data-testid="gb-refakat-auto-print">
          <FlagToggle
            title="Refakat kartını kendiliğinden yazdır"
            summary={`Belgeden ${TERIM.terbiyeIsEmri.tekilKucuk} açılınca refakat kartı hemen yazıcıya gönderilir.`}
            desc={`Kapalı (varsayılan) = bugünkü davranış: kart ${TERIM.terbiyeIsEmri.tekilKucuk} detayından elle basılır. Açıkken yazdırma penceresi iptal edilirse kart basılmamış sayılır.`}
            defaultOn={false}
            checked={draft.print.value === true}
            onChange={draft.print.set}
          />
        </div>
      )}
      {draft.lookup.server !== undefined && (
        <div data-testid="gb-station-doc-lookup">
          <FlagToggle
            title="İstasyonda belge okutarak iş bul"
            summary={`Kurşun ve tambur tabletinde "Belge okut": boyahane belgesinin fotoğrafından fiş no okunur, bağlı ${TERIM.terbiyeIsEmri.tekilKucuk} açılır.`}
            desc={`Kapalı (varsayılan) = bugünkü davranış: tablette düğme yok. Okuma yalnız eşleme içindir; yeni gelen belge doğmaz. Fiş / evrak / parti no ile elle arama listede her zaman vardır.`}
            defaultOn={false}
            checked={draft.lookup.value === true}
            onChange={draft.lookup.set}
          />
        </div>
      )}
      <EnumField
        id="gb-photo-retention"
        label="Belge fotoğrafı saklama"
        desc="Onaylı belgenin fotoğrafı ne kadar saklansın. Belge, satırlar, okuma sonucu ve belge no her kipte kalır; yalnız fotoğrafın kendisi küçülür ya da silinir. Seçim GEÇMİŞ onaylı belgelere de uygulanır (kaydedince arka planda başlar); silinen fotoğraf geri gelmez. Silmeden önce onay ekranında belge no'nun doğru olduğunu kontrol edin."
        pair={draft.retention}
        options={PHOTO_RETENTION_OPTIONS}
      />
    </>
  );
}
