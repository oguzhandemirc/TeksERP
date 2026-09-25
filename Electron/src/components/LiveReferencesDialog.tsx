// =============================================================================
// "PASİFE ALINAMAZ" DİYALOĞU — arşiv 409'unun kayıtları tek tek (App düzeyinde tek mount)
// =============================================================================
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { registerLiveReferencesPresenter, type LiveReferencesNotice } from "@/lib/live-references";
import { LiveReferencesList } from "./LiveReferencesList";

export function LiveReferencesDialog() {
  const [notice, setNotice] = useState<LiveReferencesNotice | null>(null);
  useEffect(() => {
    registerLiveReferencesPresenter(setNotice);
    return () => registerLiveReferencesPresenter(null);
  }, []);
  return (
    <Dialog open={notice !== null} onOpenChange={(o) => !o && setNotice(null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Pasife alınamaz</DialogTitle>
          <DialogDescription>{notice?.message}</DialogDescription>
        </DialogHeader>
        {notice && <LiveReferencesList references={notice.references} />}
        <DialogFooter>
          <Button onClick={() => setNotice(null)}>Tamam</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
