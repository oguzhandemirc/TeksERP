// Cari Hesaplar satırından açılan "Başka cariyle birleştir" modalı (D4-K3e). Adım 1: hedef seçici — aynı kartın
// öbür hesapları DOĞRUDAN listelenir (combobox yok; farklı kimlik zaten engeldir). Adım 2: ön izleme + yazılı onay.
// Yön sunucudan (eski fason bacağı → kartın kendi hesabı); kullanıcı yönü seçmez.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiErrorText } from "@/lib/api-error";
import { money, type CariRow } from "../service";
import { getMergeCandidates, type CariMergeCandidate } from "./cariMergeService";
import { CariMergePreviewStep } from "./CariMergePreviewStep";

type Currency = CariRow["defaultCurrency"];

interface Props {
  cariId: string;
  cariName: string;
  onClose: () => void;
}

export function CariMergeDialog({ cariId, cariName, onClose }: Props) {
  const [picked, setPicked] = useState<CariMergeCandidate | null>(null);
  const q = useQuery({ queryKey: ["cari-merge", "candidates", cariId], queryFn: () => getMergeCandidates(cariId), enabled: !picked });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Başka cariyle birleştir — {cariName}</DialogTitle>
          <DialogDescription>
            {picked ? "Aktarılacak her kalemi kontrol edin; onay yazısıyla uygulayın." : "Aynı karta açılmış öbür hesabı seçin."}
          </DialogDescription>
        </DialogHeader>
        {picked ? (
          <CariMergePreviewStep sourceId={picked.sourceId} targetId={picked.targetId} onBack={() => setPicked(null)} onDone={onClose} />
        ) : q.isLoading ? (
          <p className="text-sm text-muted-foreground">Hesaplar yükleniyor…</p>
        ) : q.isError ? (
          <p role="alert" className="text-sm text-destructive">{apiErrorText(q.error, "Hesaplar alınamadı.")}</p>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu hesapla birleştirilebilecek başka hesap yok — birleştirme yalnız aynı karta açılmış iki hesap arasında yapılır.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {(q.data ?? []).map((c) => (
              <li key={c.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.kind === "CUSTOMER" ? "Kartın hesabı" : "Eski fason hesabı"}
                    {c.isActive ? "" : " · Pasif"}
                    {c.balances.length > 0 ? ` · bakiye ${c.balances.map((b) => money(b.balance, b.currency as Currency)).join(" · ")}` : " · bakiye yok"}
                  </p>
                  <p className="text-xs text-muted-foreground">Yön: {c.sourceId === cariId ? "bu hesap → seçilen hesap" : "seçilen hesap → bu hesap"}</p>
                </div>
                <Button size="sm" onClick={() => setPicked(c)}>Ön izle</Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
