// e-İrsaliye eylem çubuğu: görünürlük `eirsaliyeActions` saf fonksiyonundan; pencereler
// ayrı dosyalarda. Hiç eylem yoksa çubuk çizilmez.
import { useState } from "react";
import { Download, FilePlus2, FileX2, PencilLine, RefreshCw, Send, Undo2, Upload, MessageSquareReply, FileCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CancelDialog } from "./CancelDialog";
import { GenerateResultDialog } from "./GenerateResultDialog";
import { MarkSentDialog } from "./MarkSentDialog";
import { PrepareDialog } from "./PrepareDialog";
import { RegenerateConfirmDialog } from "./RegenerateConfirmDialog";
import { ResponseDialog } from "./ResponseDialog";
import { UndoDialog } from "./UndoDialog";
import type { EIrsaliyeActions } from "./eirsaliyeActions";
import { useEIrsaliyeCommands, type CommandKind } from "./useEIrsaliyeCommands";
import { useEIrsaliyeRefresh } from "./useEIrsaliye";
import type { EIrsaliyeRecord } from "./types";

type DialogKind = "prepare" | "edit" | "markSent" | "response" | "undo" | "cancel" | null;

export function EIrsaliyeActionBar({ shipmentId, record, actions }: { shipmentId: string; record: EIrsaliyeRecord | null; actions: EIrsaliyeActions }) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const refresh = useEIrsaliyeRefresh(shipmentId);
  const cmd = useEIrsaliyeCommands(record, refresh);
  const close = () => setDialog(null);
  if (!Object.values(actions).some(Boolean)) return null;
  return (
    <>
      <ActionButtons actions={actions} pending={cmd.pending} onDialog={setDialog} onCommand={(k) => (k === "regenerate" ? cmd.regenerate() : void cmd.run(k))} />
      <PrepareDialog open={dialog === "prepare" || dialog === "edit"} onOpenChange={(o) => !o && close()} shipmentId={shipmentId} record={dialog === "edit" ? record : null} onDone={refresh} />
      <MarkSentDialog record={dialog === "markSent" ? record : null} onClose={close} onDone={refresh} />
      <ResponseDialog record={dialog === "response" ? record : null} onClose={close} onDone={refresh} />
      <UndoDialog record={dialog === "undo" ? record : null} onClose={close} onDone={refresh} />
      <CancelDialog record={dialog === "cancel" ? record : null} onClose={close} onDone={refresh} />
      <RegenerateConfirmDialog open={cmd.confirmRegenerate} pending={cmd.pending === "regenerate"} onConfirm={() => void cmd.run("regenerate", true)} onClose={cmd.closeRegenerate} />
      <GenerateResultDialog
        issues={cmd.issues}
        onClose={cmd.clearIssues}
        onEditFields={actions.editFields ? () => { cmd.clearIssues(); setDialog("edit"); } : undefined}
      />
    </>
  );
}

function ActionButtons({
  actions: a,
  pending,
  onDialog,
  onCommand,
}: {
  actions: EIrsaliyeActions;
  pending: CommandKind | null;
  onDialog: (d: DialogKind) => void;
  onCommand: (k: CommandKind) => void;
}) {
  const busy = pending !== null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="eirsaliye-actions">
      {a.prepare && <Button size="sm" onClick={() => onDialog("prepare")}><FilePlus2 /> e-İrsaliye hazırla</Button>}
      {a.generate && <Button size="sm" disabled={busy} onClick={() => onCommand("generate")}><FileCog /> XML üret</Button>}
      {a.markSent && <Button size="sm" onClick={() => onDialog("markSent")}><Upload /> Portala yükledim</Button>}
      {a.send && <Button size="sm" disabled={busy} onClick={() => onCommand("send")}><Send /> Simülasyon gönder</Button>}
      {a.response && <Button size="sm" onClick={() => onDialog("response")}><MessageSquareReply /> Yanıt kaydet</Button>}
      {a.poll && <Button size="sm" variant="outline" disabled={busy} onClick={() => onCommand("poll")}><RefreshCw /> Durumu sorgula</Button>}
      {a.download && <Button size="sm" variant="outline" disabled={busy} onClick={() => onCommand("download")}><Download /> XML indir</Button>}
      {a.regenerate && <Button size="sm" variant="outline" disabled={busy} onClick={() => onCommand("regenerate")}><RefreshCw /> Yeniden üret</Button>}
      {a.editFields && <Button size="sm" variant="outline" onClick={() => onDialog("edit")}><PencilLine /> Taşıma bilgileri</Button>}
      {a.undo && <Button size="sm" variant="ghost" onClick={() => onDialog("undo")}><Undo2 /> Geri al</Button>}
      {a.cancel && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDialog("cancel")}><FileX2 /> İptal</Button>}
    </div>
  );
}
