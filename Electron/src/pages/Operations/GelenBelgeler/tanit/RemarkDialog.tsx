// "Fotoğrafla yeniden işaretle" (Belge Tipleri kartı): tanıtma sayfası bir belgenin fotoğrafını ister (`/:id/tanit?sablon=`).
// Seçenekler: yeni fotoğraf yükle (okununca o tipin güncelleme kipinde açılır) ya da bu tipin açık taslaklarından biri (önizleme
// ucu salt okunur). Onaylı bir belgeyle güncellemek için belgenin detayındaki "Tanımı düzenle" anlatılır.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScanText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useTabsStore } from "@/store/tabs";
import { UploadDialog } from "../UploadDialog";
import { teachPath } from "../paths";
import { previewTemplateReset } from "./service";

export function RemarkDialog({ code, name, onOpenChange }: { code: string; name: string; onOpenChange: (open: boolean) => void }) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const canUpload = useRoleAccess().hasPermission("gelen-belge:write");
  const [upload, setUpload] = useState(false);
  const info = useQuery({ queryKey: ["gelen-belge-sablon-taslaklar", code], queryFn: () => previewTemplateReset([code]), staleTime: 0 });
  const drafts = info.data?.items[0]?.drafts ?? [];
  const go = (noteId: string) => {
    onOpenChange(false);
    navigateActive(teachPath(noteId, code));
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="remark-dialog">
        <DialogHeader>
          <DialogTitle>Fotoğrafla yeniden işaretle — {name}</DialogTitle>
          <DialogDescription>Bu tipten bir belgenin fotoğrafında alanları yeniden işaretleyin; kayıt yeni sürüm açar, eski belgeler okundukları sürümde kalır.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {canUpload ? (
            <Button onClick={() => setUpload(true)} data-testid="remark-upload"><ScanText className="mr-1 h-4 w-4" /> Yeni fotoğraf yükle</Button>
          ) : (
            <p className="text-xs text-muted-foreground">Fotoğraf yüklemek için gelen belge yazma izni gerekir.</p>
          )}
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Ya da bu tipin açık taslaklarından biri</div>
            {info.isLoading && <p className="text-xs text-muted-foreground">Yükleniyor…</p>}
            {!info.isLoading && drafts.length === 0 && <p className="text-xs text-muted-foreground">Açık taslak yok.</p>}
            <div className="max-h-48 space-y-1 overflow-auto">
              {drafts.map((d) => (
                <button key={d.id} type="button" className="flex w-full justify-between rounded-md border px-3 py-1.5 text-left hover:bg-muted" onClick={() => go(d.id)} data-testid={`remark-draft-${d.id}`}>
                  <span className="font-mono text-xs">{d.documentNo}</span>
                  <span className="text-xs text-muted-foreground">{d.senderDocNo ?? ""}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Onaylı bir belgeyle güncellemek için Gelen Belgeler'de belgeyi açıp "Tanımı düzenle"yi kullanın.</p>
        </div>
        {upload && <UploadDialog open autoSend target={{ kind: "new" }} onOpenChange={setUpload} onDone={(note) => go(note.id)} />}
      </DialogContent>
    </Dialog>
  );
}
