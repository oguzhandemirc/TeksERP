// Detay başlığı "⋯ Diğer" menüsü: ikincil eylemler (sayfa ekle · tanıt · Excel satır) + ayrı grupta yıkıcılar (iptal · taslağı iptal et).
// Diyaloglar menünün DIŞINDA durur (menü kapanınca içerik söner); izin/durum süzgeçleri eski düğmelerle aynıdır.
import { useState } from "react";
import { Ban, Download, FileSpreadsheet, FileX, ImagePlus, MoreHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { AddPagesDialog } from "./AddPagesAction";
import { CancelNoteDialog } from "./CancelNoteDialog";
import { DeleteDraftNoteDialog } from "./DeleteDraftNoteAction";
import { useTeachAction } from "./tanit/TeachEntry";
import { isCancellable } from "./noteStatus";
import type { LineImport } from "./LineImportButton";
import type { DeliveryNoteDetail } from "./types";

type DialogKind = "pages" | "cancel" | "delete" | null;

interface Props {
  note: DeliveryNoteDetail;
  listPath: string;
  /** Excel satır yükleme yalnız düzenlenebilir taslakta (null = madde yok). */
  lineImport: LineImport | null;
  onPagesAdded: () => void;
}

const DESTRUCTIVE = "text-destructive focus:bg-destructive/10 focus:text-destructive";

export function DetailMoreMenu({ note, listPath, lineImport, onPagesAdded }: Props) {
  const { hasPermission } = useRoleAccess();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const teach = useTeachAction(note);
  const canWrite = hasPermission("gelen-belge:write");
  const canAddPages = note.status === "DRAFT" && canWrite;
  const canCancel = isCancellable(note.status) && hasPermission("gelen-belge:cancel");
  const canDeleteDraft = note.status === "DRAFT" && canWrite;
  const hasMain = canAddPages || !!teach || !!lineImport;
  const hasDestructive = canCancel || canDeleteDraft;
  const close = (open: boolean) => !open && setDialog(null);
  return (
    <>
      {(hasMain || hasDestructive) && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" data-testid="note-more-menu">
              <MoreHorizontal className="mr-1 h-4 w-4" />
              Diğer
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[13rem]">
            {canAddPages && (
              <DropdownMenuItem onSelect={() => setDialog("pages")} data-testid="note-add-pages">
                <ImagePlus className="mr-2 h-4 w-4" /> Sayfa ekle
              </DropdownMenuItem>
            )}
            {teach?.kind === "ready" && (
              <DropdownMenuItem onSelect={teach.run} data-testid="note-teach">
                <Sparkles className="mr-2 h-4 w-4" /> {teach.label}
              </DropdownMenuItem>
            )}
            {teach?.kind === "purged" && (
              <DropdownMenuItem disabled title={teach.title} data-testid="note-teach-purged">
                <Sparkles className="mr-2 h-4 w-4" /> {teach.label}
              </DropdownMenuItem>
            )}
            {lineImport && (
              <>
                <DropdownMenuItem disabled={lineImport.busy} onSelect={lineImport.pick} data-testid="note-line-import">
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel'den satır yükle
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={lineImport.downloadTemplate} data-testid="note-line-template">
                  <Download className="mr-2 h-4 w-4" /> Excel şablonunu indir
                </DropdownMenuItem>
              </>
            )}
            {hasMain && hasDestructive && <DropdownMenuSeparator />}
            {canCancel && (
              <DropdownMenuItem className={DESTRUCTIVE} onSelect={() => setDialog("cancel")} data-testid="note-cancel">
                <Ban className="mr-2 h-4 w-4" /> Belgeyi iptal et
              </DropdownMenuItem>
            )}
            {canDeleteDraft && (
              <DropdownMenuItem className={DESTRUCTIVE} onSelect={() => setDialog("delete")} data-testid="note-delete-draft">
                <FileX className="mr-2 h-4 w-4" /> Taslağı iptal et
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {lineImport?.input}
      {dialog === "pages" && <AddPagesDialog note={note} onOpenChange={close} onDone={onPagesAdded} />}
      {dialog === "cancel" && <CancelNoteDialog note={note} open onOpenChange={close} />}
      <DeleteDraftNoteDialog note={note} listPath={listPath} open={dialog === "delete"} onOpenChange={close} />
    </>
  );
}
