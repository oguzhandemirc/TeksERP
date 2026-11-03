// K30-T menü girişi "Belge Tanıt": belge fotoğrafını yükle → okuma başlar → tanıtma sayfasına geçilir (okuma bitene dek orada
// "Belge okunuyor…" görünür; not detayı 5 sn'de bir tazelenir). Böylece tanıtma için önce Gelen Belgeler'de belge aramak gerekmez.
import { useState } from "react";
import { ScanText } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useTabsStore } from "@/store/tabs";
import { UploadDialog } from "../UploadDialog";
import { teachPath } from "../paths";

export function TeachStartPage() {
  const [open, setOpen] = useState(false);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  return (
    <PageShell>
      <PageHeader
        title="Belge Tanıt"
        description="Yeni bir belge tipini sisteme öğretin: belgenin fotoğrafını yükleyin, okununca başlığa ve değerlere sırayla dokunun. Sonraki aynı tip belgeler sorusuz dolar."
        parent={{ label: "Gelen Belgeler", to: "/operations/gelen-belgeler" }}
      />
      <PageBody className="min-h-0 p-4 sm:p-6">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center" data-testid="teach-start">
          <p className="text-sm text-muted-foreground">Tanıtılacak belgenin net, düz çekilmiş bir fotoğrafı yeterli.</p>
          <Button onClick={() => setOpen(true)} data-testid="teach-start-upload">
            <ScanText className="mr-1 h-4 w-4" /> Belge fotoğrafı yükle
          </Button>
        </div>
        {open && <UploadDialog open autoSend target={{ kind: "new" }} onOpenChange={setOpen} onDone={(note) => navigateActive(teachPath(note.id))} />}
      </PageBody>
    </PageShell>
  );
}
