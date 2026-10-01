import { useRef } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { licenseService } from "@/services/licenseService";
import { useLicenseAction } from "./hooks";

/** İmzalı lisans yanıtı birkaç on KB'tır; bundan büyüğü lisans dosyası değildir. */
export const LICENSE_FILE_MAX_BYTES = 512 * 1024;

/**
 * "Lisans dosyası yükle" — portalın istek gerektirmeyen çevrimdışı uzatma dosyası. İçerik çevrimdışı
 * yanıtla AYNI uca gider; imza ve tazelik backend'de doğrulanır (eski dosya `LICENSE_LEASE_STALE`).
 */
export function LicenseFileUpload() {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useLicenseAction();
  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (file.size > LICENSE_FILE_MAX_BYTES) {
      toast.error("Seçilen dosya lisans dosyası olamayacak kadar büyük.");
      return;
    }
    void run("dosya", async () => {
      await licenseService.licenseFile(await file.text());
      return "Lisans dosyası kabul edildi.";
    });
  };
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-2">
      <span className="text-xs text-muted-foreground">İnternet yoksa: portaldan alınan uzatma dosyası</span>
      <input
        ref={input}
        type="file"
        className="hidden"
        data-testid="lisans-dosyasi-girdi"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => input.current?.click()}>
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        {busy === "dosya" ? "Yükleniyor…" : "Lisans dosyası yükle"}
      </Button>
    </div>
  );
}
