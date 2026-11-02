// Gelen belge → okuma seçenekleri (backend tek yazar `PUT /api/gelen-belge/ayarlar`; yeni okumaya uygulanır):
//   · tablosuz belgede (ürün sevk fişi) metre kaynağı — çıkış toplamı (varsayılan, bugünkü) | giriş toplamı
//   · okunan şablonun gönderen carisini boş gönderen alanına yaz — kapalı (varsayılan, bugünkü)
// Eski backend alanları göndermez → ilgili alan çizilmez (yazılamayan ayar gösterilmez).
import { useState } from "react";
import { FieldLabel, FlagToggle } from "./SettingRow";
import { EnumRadioOptions } from "./EnumRadioOptions";
import type { HeaderLineMeterSource, IncomingDocumentSettings } from "@/pages/Operations/GelenBelgeler/types";

export const HEADER_LINE_SOURCE_OPTIONS: ReadonlyArray<{ value: HeaderLineMeterSource; label: string; hint: string }> = [
  { value: "OUTPUT", label: "Çıkış (sevk edilen) metre", hint: "Belgedeki çıkış toplamı alınır; yoksa giriş toplamı (bugünkü davranış)." },
  { value: "INPUT", label: "Giriş metresi", hint: "Belgedeki giriş toplamı alınır; yoksa çıkış toplamı. Kg da aynı taraftan alınır." },
];

/** Okuma seçenekleri taslağı; sunucu alanı yoksa (eski backend) gövdeye girmez. */
export function useReadOptionsDraft(server: IncomingDocumentSettings | undefined) {
  const serverSource = server?.headerLineMeterSource;
  const serverAutoSender = server?.autoSenderFromTemplate;
  const [source, setSource] = useState<HeaderLineMeterSource | undefined>(serverSource);
  const [autoSender, setAutoSender] = useState<boolean | undefined>(serverAutoSender);
  const sourceDirty = serverSource !== undefined && source !== undefined && source !== serverSource;
  const senderDirty = serverAutoSender !== undefined && autoSender !== undefined && autoSender !== serverAutoSender;
  const reset = () => { setSource(serverSource); setAutoSender(serverAutoSender); };
  const body = { ...(sourceDirty ? { headerLineMeterSource: source } : {}), ...(senderDirty ? { autoSenderFromTemplate: autoSender } : {}) };
  return { serverSource, serverAutoSender, source, setSource, autoSender, setAutoSender, dirty: sourceDirty || senderDirty, body, reset, defaultSource: server?.defaultHeaderLineMeterSource };
}

export function ReadOptionsFields({ draft }: { draft: ReturnType<typeof useReadOptionsDraft> }) {
  return (
    <>
      {draft.serverSource !== undefined && (
        <div data-testid="gb-header-line-source">
          <FieldLabel
            htmlFor="gb-header-line-source-radios"
            label="Tablosuz sevk fişinde metre"
            desc="Top dökümü olmayan tek toplu sevk fişinde (ör. ürün sevk fişi: giriş ve çıkış toplamı yazar) satırın metresi hangi toplamdan alınsın. Yeni okunan sayfalara uygulanır; faturalama makine ölçümünden yapılır."
          />
          <div id="gb-header-line-source-radios" className="mt-2">
            <EnumRadioOptions name="Tablosuz sevk fişinde metre" value={draft.source ?? "OUTPUT"} options={HEADER_LINE_SOURCE_OPTIONS} onChange={(v) => draft.setSource(v as HeaderLineMeterSource)} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {HEADER_LINE_SOURCE_OPTIONS.find((o) => o.value === (draft.defaultSource ?? "OUTPUT"))?.label}</p>
        </div>
      )}
      {draft.serverAutoSender !== undefined && (
        <div data-testid="gb-auto-sender">
          <FlagToggle
            title="Gönderen cariyi okunan şablondan doldur"
            summary="Belge şablonu tanınınca, Gönderen Şablonları ekranında o şablona bağlı gönderen cari taslağa yazılır."
            desc="Yalnız gönderen alanı boşken ve şablon ile cari aktifken yazılır; operatörün seçtiği gönderen ezilmez, yeni okunan sayfalara uygulanır. Sahip (müşteri) hiçbir zaman otomatik dolmaz. Kapalı (varsayılan) = bugünkü davranış: gönderen yalnız öneri olarak gösterilir."
            defaultOn={false}
            checked={draft.autoSender === true}
            onChange={draft.setAutoSender}
          />
        </div>
      )}
    </>
  );
}
