// Kişisel profil adı: yeni kayıt ("Profili kaydet") ya da yeniden adlandırma. Ad sunucuda kişi başına tekil
// (harf duyarsız); çakışma cümlesi sunucudan gelir.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const PROFILE_NAME_MAX = 60;

export function ProfileNameDialog(p: {
  open: boolean;
  /** Verilirse yeniden adlandırma. */
  mevcutAd?: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (ad: string) => void;
}) {
  const [ad, setAd] = useState("");
  useEffect(() => {
    if (p.open) setAd(p.mevcutAd ?? "");
  }, [p.open, p.mevcutAd]);
  const valid = ad.trim().length > 0 && ad.trim().length <= PROFILE_NAME_MAX;
  return (
    <Dialog open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{p.mevcutAd ? "Profili yeniden adlandır" : "Profili kaydet"}</DialogTitle>
          <DialogDescription>
            {p.mevcutAd ? "Profilin seçimi değişmez." : "Şu anki bildirim seçiminiz bu adla saklanır; tek tıkla geri dönebilirsiniz."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !p.pending) p.onSubmit(ad.trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tercih-profil-ad">Ad</Label>
            <Input id="tercih-profil-ad" autoFocus maxLength={PROFILE_NAME_MAX} value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Ör. Gece, Fuar haftası" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={p.onClose}>Vazgeç</Button>
            <Button type="submit" disabled={!valid || p.pending}>Kaydet</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
