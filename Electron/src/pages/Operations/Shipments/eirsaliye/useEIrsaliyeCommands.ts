// Pencere istemeyen eylemler: üret · yeniden üret · indir · gönder (simülasyon) · sorgula.
// Doğrulama hatası pencereye gider; indirilmiş XML'in yeniden üretimi onay ister.
import { useState } from "react";
import { toast } from "sonner";
import { apiErrorText } from "@/lib/api-error";
import { saveTextAs } from "@/lib/file-save";
import { eIrsaliyeErrorCode, eIrsaliyeService, eIrsaliyeValidationIssues } from "./service";
import type { EIrsaliyeRecord, EIrsaliyeValidationIssue } from "./types";

export type CommandKind = "generate" | "regenerate" | "download" | "send" | "poll";

export function useEIrsaliyeCommands(record: EIrsaliyeRecord | null, refresh: () => void) {
  const [pending, setPending] = useState<CommandKind | null>(null);
  const [issues, setIssues] = useState<EIrsaliyeValidationIssue[] | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const fail = (e: unknown, kind: CommandKind) => {
    const list = eIrsaliyeValidationIssues(e);
    if (list.length > 0) return setIssues(list);
    if (kind === "regenerate" && eIrsaliyeErrorCode(e) === "EIRSALIYE_ALREADY_DOWNLOADED") return setConfirmRegenerate(true);
    // Gönder/sorgula/indir genel toast'ı apiClient basar; üretim uçları sessiz çağrılır.
    if (kind === "generate" || kind === "regenerate") toast.error(apiErrorText(e, "XML üretilemedi."));
  };

  const run = async (kind: CommandKind, onay = false) => {
    if (!record) return;
    setPending(kind);
    try {
      if (kind === "generate") await eIrsaliyeService.generate(record.id);
      if (kind === "regenerate") await eIrsaliyeService.regenerate(record.id, onay);
      if (kind === "send") await eIrsaliyeService.send(record.id);
      if (kind === "poll") await eIrsaliyeService.poll(record.id);
      if (kind === "download") {
        const d = await eIrsaliyeService.download(record.id);
        const saved = await saveTextAs(d.xml, d.dosyaAdi, "application/xml;charset=utf-8");
        if (saved) toast.success(`${d.dosyaAdi} kaydedildi.`);
      } else {
        toast.success(SUCCESS[kind]);
      }
      setConfirmRegenerate(false);
      refresh();
    } catch (e) {
      fail(e, kind);
    } finally {
      setPending(null);
    }
  };

  return {
    pending,
    issues,
    clearIssues: () => setIssues(null),
    confirmRegenerate,
    closeRegenerate: () => setConfirmRegenerate(false),
    /** İndirilmişse doğrudan onay penceresi; değilse sunucuya onaysız sorar. */
    regenerate: () => (record?.lastDownloadedAt ? setConfirmRegenerate(true) : void run("regenerate")),
    run,
  };
}

const SUCCESS: Record<Exclude<CommandKind, "download">, string> = {
  generate: "e-İrsaliye numarası ve XML üretildi.",
  regenerate: "XML yeniden üretildi.",
  send: "Gönderildi (simülasyon).",
  poll: "Durum sorgulandı.",
};
