// Gelen belge → aynı gönderen belge no tekrar gelirse (Gülkesim K27; tek yazar `PUT /api/gelen-belge/ayarlar`):
//   Engelle (varsayılan, bugünkü) · İşi sürüyorsa uyar (onayda sorulur) · Serbest. Hüküm sunucuda; eski backend
//   alanı göndermez → alan çizilmez, gövdeye girmez.
import { useState } from "react";
import { FieldLabel } from "./SettingRow";
import { EnumRadioOptions } from "./EnumRadioOptions";
import type { IncomingDocumentSettings } from "@/pages/Operations/GelenBelgeler/types";
import type { DuplicateDocNoMode } from "@/pages/Operations/GelenBelgeler/mukerrerTypes";

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
