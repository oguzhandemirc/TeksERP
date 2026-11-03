// K30-T menü girişi "Belge Tanıt": belge fotoğrafını yükle → okuma başlar → tanıtma sayfasına geçilir (okuma bitene dek orada
// "Belge okunuyor…" görünür; not detayı 5 sn'de bir tazelenir). Böylece tanıtma için önce Gelen Belgeler'de belge aramak gerekmez.
// Yükleme yeni gelen belge TASLAĞI yaratır (gelen-belge:write); yalnız template izni olana yükleme yerine açık mesaj gösterilir.
import { useState } from "react";
import { ScanText } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useTabsStore } from "@/store/tabs";
import { UploadDialog } from "../UploadDialog";
import { teachPath } from "../paths";

export function TeachStartPage() {
  const [open, setOpen] = useState(false);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const canUpload = useRoleAccess().hasPermission("gelen-belge:write");
  return (
    <PageShell>
      <PageHeader
        title="Belge Tanıt"
        description="Yeni bir belge tipini sisteme öğretin: belgenin fotoğrafını yükleyin, okununca başlığa ve değerlere sırayla dokunun. Sonraki aynı tip belgeler sorusuz dolar."
        parent={{ label: "Gelen Belgeler", to: "/operations/gelen-belgeler" }}
      />
      <PageBody className="min-h-0 p-4 sm:p-6">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center" data-testid="teach-start">
          <p className="text-sm text-muted-foreground">Tanıtılacak belgenin net, düz çekilmiş bir fotoğrafı yeterli. Yüklenen fotoğraf Gelen Belgeler'de taslak belge olarak kalır.</p>
          {canUpload ? (
            <Button onClick={() => setOpen(true)} data-testid="teach-start-upload">
              <ScanText className="mr-1 h-4 w-4" /> Belge fotoğrafı yükle
            </Button>
          ) : (
            <p className="text-sm text-amber-800 dark:text-amber-300" data-testid="teach-start-no-write">
              Belge yüklemek için gelen belge yazma izni gerekir. Mevcut bir belgeyi tanıtmak için Gelen Belgeler'de belgeyi açıp "Bu belgeyi tanıt"ı kullanın.
            </p>
          )}
        </div>
        {open && canUpload && <UploadDialog open autoSend target={{ kind: "new" }} onOpenChange={setOpen} onDone={(note) => navigateActive(teachPath(note.id))} />}
      </PageBody>
    </PageShell>
  );
}
