// Gelen belge → aynı gönderen belge no tekrar gelirse (Gülkesim K27; tek yazar `PUT /api/gelen-belge/ayarlar`):
//   Engelle (varsayılan, bugünkü) · İşi sürüyorsa uyar (onayda sorulur) · Serbest. Hüküm sunucuda; eski backend
//   alanı göndermez → alan çizilmez, gövdeye girmez.
// Aynı müşteri parti no tekrar gelirse (`gelenBelge.duplicateBatchNo`): Engelle · Uyar · İzin ver (varsayılan, bugünkü).
import { useState } from "react";
import { FieldLabel } from "./SettingRow";
import { EnumRadioOptions } from "./EnumRadioOptions";
import type { IncomingDocumentSettings } from "@/pages/Operations/GelenBelgeler/types";
import type { DuplicateDocNoMode } from "@/pages/Operations/GelenBelgeler/mukerrerTypes";
import { TERIM } from "@/lib/terim";

export const DUPLICATE_DOC_NO_OPTIONS: ReadonlyArray<{ value: DuplicateDocNoMode; label: string; hint: string }> = [
  { value: "BLOCK", label: "Engelle", hint: "Aynı müşterinin aynı belge no'su ikinci kez kaydedilemez; iptal edilen belgenin numarası serbesttir (bugünkü davranış)." },
  { value: "WARN", label: "İşi sürüyorsa uyar", hint: "Aynı belge no'lu belgenin işi sürüyorsa onayda sorulur, \"Yine de onayla\" ile geçer. İşi bitmiş ya da iptal edilmiş belgede sorulmaz; aynı fotoğraf yeni belgeye yeniden yüklenebilir." },
  { value: "ALLOW", label: "Serbest", hint: "Aynı belge no kontrol edilmez. Boyahaneler numarayı tekrar kullanıyorsa seçilir." },
];

/** Taslak; sunucu alanı yoksa (eski backend) gövdeye girmez. */
export function useDuplicateDocNoDraft(server: IncomingDocumentSettings | undefined) {
  const serverValue = server?.duplicateDocNo;
  const [value, setValue] = useState<DuplicateDocNoMode | undefined>(serverValue);
  const dirty = serverValue !== undefined && value !== undefined && value !== serverValue;
  return { serverValue, value, set: setValue, fallback: server?.defaultDuplicateDocNo, dirty, body: dirty ? { duplicateDocNo: value } : {}, reset: () => setValue(serverValue) };
}

export function DuplicateDocNoField({ draft }: { draft: ReturnType<typeof useDuplicateDocNoDraft> }) {
  if (draft.serverValue === undefined) return null;
  return (
    <div data-testid="gb-duplicate-doc-no">
      <FieldLabel
        htmlFor="gb-duplicate-doc-no-radios"
        label="Aynı belge no tekrar gelirse"
        desc="Aynı müşteriden aynı gönderen belge no'lu ikinci belge gelince ne olsun. Bazı boyahaneler numarayı tekrar kullanır; aynı kâğıdın iki kez okutulmasını yakalamak için işi süren belgede sormak yeterli olabilir."
      />
      <div id="gb-duplicate-doc-no-radios" className="mt-2">
        <EnumRadioOptions name="Aynı belge no tekrar gelirse" value={draft.value ?? "BLOCK"} options={DUPLICATE_DOC_NO_OPTIONS} onChange={(v) => draft.set(v as DuplicateDocNoMode)} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {DUPLICATE_DOC_NO_OPTIONS.find((o) => o.value === (draft.fallback ?? "BLOCK"))?.label}</p>
    </div>
  );
}

export const DUPLICATE_BATCH_NO_OPTIONS: ReadonlyArray<{ value: DuplicateDocNoMode; label: string; hint: string }> = [
  { value: "BLOCK", label: "Engelle", get hint() { return `Aynı müşterinin aynı parti no'su işi süren başka bir belgede ya da ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} varsa kayıt yapılmaz. İptal edilmiş ya da işi bitmiş belge sayılmaz.`; } },
  { value: "WARN", label: "Uyar", hint: "Kayıtta \"Bu parti zaten var\" diye sorulur, \"Yine de aç\" ile geçer. Aynı kâğıdın farklı fotoğrafla ikinci kez okutulmasını yakalar." },
  { value: "ALLOW", label: "İzin ver", hint: "Müşteri parti no kontrol edilmez (bugünkü davranış)." },
];

/** Taslak; sunucu alanı yoksa (eski backend) gövdeye girmez. */
export function useDuplicateBatchNoDraft(server: IncomingDocumentSettings | undefined) {
  const serverValue = server?.duplicateBatchNo;
  const [value, setValue] = useState<DuplicateDocNoMode | undefined>(serverValue);
  const dirty = serverValue !== undefined && value !== undefined && value !== serverValue;
  return { serverValue, value, set: setValue, fallback: server?.defaultDuplicateBatchNo, dirty, body: dirty ? { duplicateBatchNo: value } : {}, reset: () => setValue(serverValue) };
}

export function DuplicateBatchNoField({ draft }: { draft: ReturnType<typeof useDuplicateBatchNoDraft> }) {
  if (draft.serverValue === undefined) return null;
  return (
    <div data-testid="gb-duplicate-batch-no">
      <FieldLabel
        htmlFor="gb-duplicate-batch-no-radios"
        label="Aynı müşteri parti no tekrar gelirse"
        desc="Aynı müşteriden aynı parti no'lu ikinci kayıt gelince ne olsun. Büyük/küçük harf ve boşluk farkı yok sayılır; aynı belgenin kendi partileri birbirini tetiklemez."
      />
      <div id="gb-duplicate-batch-no-radios" className="mt-2">
        <EnumRadioOptions name="Aynı müşteri parti no tekrar gelirse" value={draft.value ?? "ALLOW"} options={DUPLICATE_BATCH_NO_OPTIONS} onChange={(v) => draft.set(v as DuplicateDocNoMode)} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {DUPLICATE_BATCH_NO_OPTIONS.find((o) => o.value === (draft.fallback ?? "ALLOW"))?.label}</p>
    </div>
  );
}

/** İki mükerrer kapısının (belge no · müşteri parti no) birleşik taslağı — ayar bölümü tek değişkenle bağlar. */
export function useDuplicateDrafts(server: IncomingDocumentSettings | undefined) {
  const doc = useDuplicateDocNoDraft(server);
  const batch = useDuplicateBatchNoDraft(server);
  return { doc, batch, dirty: doc.dirty || batch.dirty, body: { ...doc.body, ...batch.body }, reset: () => { doc.reset(); batch.reset(); } };
}

export function DuplicateFields({ draft }: { draft: ReturnType<typeof useDuplicateDrafts> }) {
  return (
    <>
      <DuplicateDocNoField draft={draft.doc} />
      <DuplicateBatchNoField draft={draft.batch} />
    </>
  );
}
