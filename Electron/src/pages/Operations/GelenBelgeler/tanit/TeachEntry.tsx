// Tanıtmaya giriş (S1b): "Bu belgeyi tanıt" / "Şablonu güncelle" düğmesi ve belge tanınmadıysa "Bu belge hangi tip?" şeridi + diyaloğu.
// Yalnız `gelen-belge:template` izniyle çizilir; okunmuş fotoğrafı olmayan belgede çizilmez.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileQuestion, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { INCOMING_DOCUMENT_QUERY_KEY, listSenderTemplates } from "../service";
import { teachPath } from "../paths";
import type { DocumentScanInfo } from "../types";
import { listUserTemplates, USER_TEMPLATES_QUERY_KEY } from "./service";
import { allReadPhotosPurged, isUnrecognized, teachableScans } from "./teachScans";
import { SCAN_PURGED_TEXT } from "../photoRetention";

export interface TeachNote {
  id: string;
  templateId: string | null;
  scans: readonly Pick<DocumentScanInfo, "status" | "mimeType" | "contentState">[];
}
interface Props {
  note: TeachNote;
  /** Gezinme: verilmezse aynı sekmede (detay); iş emri formu yeni sekme verir (form kaybolmasın). */
  go?: (path: string) => void;
}

function useGo(go: Props["go"]): (path: string) => void {
  const navigate = useNavigate();
  return go ?? ((p: string) => void navigate(p));
}

/** Belgenin okunduğu şablon kullanıcı şablonuysa kodu (güncelle kipi); değilse null. */
function useOwnUserTemplate(templateId: string | null, enabled: boolean): string | null {
  const list = useQuery({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "sablonlar"], queryFn: () => listSenderTemplates(), enabled: enabled && Boolean(templateId) });
  const row = list.data?.find((r) => r.id === templateId && (r.kind === "USER" || r.code.startsWith("u-")));
  return row?.code ?? null;
}

export function TeachButton({ note, go: goProp }: Props) {
  const { hasPermission } = useRoleAccess();
  const go = useGo(goProp);
  const allowed = hasPermission("gelen-belge:template") && teachableScans(note.scans).length > 0;
  const own = useOwnUserTemplate(note.templateId, allowed);
  if (!allowed) {
    if (!hasPermission("gelen-belge:template") || !allReadPhotosPurged(note.scans)) return null;
    return (
      <Button variant="outline" disabled title={`${SCAN_PURGED_TEXT} Tanıtma için fotoğraf gerekir.`} data-testid="note-teach-purged">
        <Sparkles className="mr-1 h-4 w-4" />
        Tanıtılamaz — {SCAN_PURGED_TEXT}
      </Button>
    );
  }
  return (
    <Button variant="outline" onClick={() => go(teachPath(note.id, own))} data-testid="note-teach">
      <Sparkles className="mr-1 h-4 w-4" />
      {own ? "Şablonu güncelle" : "Bu belgeyi tanıt"}
    </Button>
  );
}

export function TypeChoiceDialog({ noteId, open, onOpenChange, go }: { noteId: string; open: boolean; onOpenChange: (v: boolean) => void; go: (path: string) => void }) {
  const list = useQuery({ queryKey: USER_TEMPLATES_QUERY_KEY, queryFn: () => listUserTemplates(), enabled: open });
  const rows = (list.data ?? []).filter((r) => r.isActive);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="teach-type-dialog">
        <DialogHeader>
          <DialogTitle>Bu belge hangi tip?</DialogTitle>
          <DialogDescription>Okuma motoru bu belgenin tipini tanıyamadı. Daha önce tanıtılan bir tipse listeden seçip o şablonu bu belgeyle güncelleyin; yeni bir tipse tanıtın.</DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-1 overflow-auto" data-testid="teach-type-list">
          {list.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
          {!list.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">Henüz tanıtılmış belge tipi yok.</p>}
          {rows.map((r) => (
            <button key={r.code} type="button" className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => go(teachPath(noteId, r.code))} data-testid={`teach-type-${r.code}`}>
              <span>{r.name}</span>
              <span className="text-xs text-muted-foreground">sürüm {r.version}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={() => go(teachPath(noteId))} data-testid="teach-type-new">
            <Sparkles className="mr-1 h-4 w-4" /> Yeni tip tanıt
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Sınıflandırma düşük (GENEL yedekle okundu): uyarı şeridi + "Belge tipini seç" diyaloğu. */
export function UnknownTypeStrip({ note, go: goProp }: Props) {
  const { hasPermission } = useRoleAccess();
  const go = useGo(goProp);
  const [open, setOpen] = useState(false);
  if (!isUnrecognized(note) || !hasPermission("gelen-belge:template")) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-testid="teach-unknown-strip">
      <span className="flex items-center gap-2">
        <FileQuestion className="h-4 w-4" /> Bu belgenin tipi tanınmadı; alanlar genel sözlükle okundu. Belge tipini tanıtırsanız sonraki belgeler doğru okunur.
      </span>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="teach-unknown-choose">Belge tipini seç</Button>
      {open && <TypeChoiceDialog noteId={note.id} open onOpenChange={setOpen} go={go} />}
    </div>
  );
}
