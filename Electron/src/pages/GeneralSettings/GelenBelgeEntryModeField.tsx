// Gelen belge → kayıt kipi seçenekleri (Gülkesim parti/metre §2.1; tek yazar `PUT /api/gelen-belge/ayarlar`):
//   · parti numarası kaynağı — seriden (varsayılan, bugünkü) | belgedeki parti no'dan
//   · onay kipi — her satır bir top (varsayılan, bugünkü) | belge başına tek kayıt (kurşun metresiyle tek top)
//   · işlem değeri çözülemeyen grupta otomatik iş emri — atla (varsayılan, bugünkü) | hedef değersiz aç
//   · iş emri formundan okutulan belge — ayrı onay (varsayılan, bugünkü) | iş emri açan kaydeder (K7) · refakat oto baskı (K9)
// Eski backend alanı göndermez → alan çizilmez, gövdeye girmez. Kip kuralı istemciye kopyalanmaz: tek kayıt kipinin
// varsayılan ürün ön koşulunu sunucu 400 ile söyler; burada yalnız önceden görünür bir uyarı var.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { FieldLabel, FlagToggle } from "./SettingRow";
import { EnumRadioOptions } from "./EnumRadioOptions";
import { TERIM } from "@/lib/terim";
import type { AutoWorkOrderPatternlessMode, BatchNumberSourceMode, IncomingDocEntryMode, IncomingDocFormApproval, IncomingDocumentSettings } from "@/pages/Operations/GelenBelgeler/types";

const IE = TERIM.terbiyeIsEmri;

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
  { value: "SKIP", label: "Atla", hint: `İşlem değeri (desen/gramaj) çözülemeyen grup için ${IE.tekilKucuk} açılmaz; onay sonucu elle açılmasını söyler (bugünkü davranış).` },
  { value: "OPEN", label: "Hedef değersiz aç", hint: `İşlem değeri çözülemeyen grup için de ${IE.tekilKucuk} açılır; hedef değer boş kalır.` },
];

export const FORM_APPROVAL_OPTIONS: ReadonlyArray<Option<IncomingDocFormApproval>> = [
  { value: "SEPARATE", label: "Ayrı onay", hint: `${IE.tekil} formundan okutulan belge taslak kalır; Gelen Belgeler'den onaylanınca ${IE.tekilKucuk} açılır (bugünkü davranış).` },
  { value: "WITH_WORK_ORDER", label: `${IE.tekil} ile birlikte`, hint: `Formdan okutulan belgeyi ${IE.tekilKucuk} açma izni olan kaydeder: belge, müşteri malı top ve ${IE.tekilKucuk} tek seferde açılır; ayrı onay adımı yok.` },
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
  const serverPrint = server?.refakatAutoPrint;
  const [autoPrint, setAutoPrint] = useState<boolean | undefined>(serverPrint);
  const printDirty = serverPrint !== undefined && autoPrint !== undefined && autoPrint !== serverPrint;
  const reset = () => {
    batch.set(batch.server as BatchNumberSourceMode); entry.set(entry.server as IncomingDocEntryMode); patternless.set(patternless.server as AutoWorkOrderPatternlessMode);
    approval.set(approval.server as IncomingDocFormApproval); setAutoPrint(serverPrint);
  };
  const body = {
    ...(batch.dirty ? { batchNumberSource: batch.value } : {}),
    ...(entry.dirty ? { entryMode: entry.value } : {}),
    ...(patternless.dirty ? { autoWorkOrderPatternless: patternless.value } : {}),
    ...(approval.dirty ? { formApproval: approval.value } : {}),
    ...(printDirty ? { refakatAutoPrint: autoPrint } : {}),
  };
  const serverKey = `${batch.server ?? ""}|${entry.server ?? ""}|${patternless.server ?? ""}|${approval.server ?? ""}|${String(serverPrint ?? "")}`;
  const print = { server: serverPrint, value: autoPrint, set: setAutoPrint };
  return { batch, entry, patternless, approval, print, dirty: batch.dirty || entry.dirty || patternless.dirty || approval.dirty || printDirty, body, reset, serverKey };
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
        desc={`Belgeden açılan ${IE.cekimKucuk.bulunma}ki partinin numarası nereden gelsin. Belgeden alınırsa taslakta seçilen parti no kullanılır.`}
        pair={draft.batch}
        options={BATCH_NUMBER_SOURCE_OPTIONS}
      />
      <EnumField
        id="gb-auto-work-order-patternless"
        label={`Gramajı çözülemeyen grupta otomatik ${IE.tekilKucuk}`}
        desc={`Onaydan sonra otomatik ${IE.tekilKucuk} açılırken işlem değeri (desen/gramaj) belgeden çözülemeyen grup ne olsun. Otomatik ${IE.tekilKucuk} kapalıysa etkisizdir.`}
        pair={draft.patternless}
        options={AUTO_WORK_ORDER_PATTERNLESS_OPTIONS}
      />
      <EnumField
        id="gb-form-approval"
        label={`${IE.tekil} formundan okutulan belge`}
        desc={`${IE.tekil} oluşturma ekranında okutulan belge nasıl kaydedilsin. "${IE.tekil} ile birlikte" seçilirse ayrı onay (gelen-belge:approve) aranmaz; ${IE.tekilKucuk} açma izni yeter.`}
        pair={draft.approval}
        options={FORM_APPROVAL_OPTIONS}
      />
      {draft.print.server !== undefined && (
        <div data-testid="gb-refakat-auto-print">
          <FlagToggle
            title="Refakat kartını kendiliğinden yazdır"
            summary={`Belgeden ${IE.tekilKucuk} açılınca refakat kartı hemen yazıcıya gönderilir.`}
            desc={`Kapalı (varsayılan) = bugünkü davranış: kart ${IE.tekilKucuk} detayından elle basılır. Açıkken yazdırma penceresi iptal edilirse kart basılmamış sayılır.`}
            defaultOn={false}
            checked={draft.print.value === true}
            onChange={draft.print.set}
          />
        </div>
      )}
    </>
  );
}
