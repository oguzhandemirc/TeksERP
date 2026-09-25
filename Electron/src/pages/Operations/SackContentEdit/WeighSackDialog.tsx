import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { toastServerSuccess } from "@/lib/serverNotes";

interface Props {
  /** Tartılacak çuval — null ise dialog kapalı. */
  sack: { id: string; sackNo: string; weightKg: number | null } | null;
  onOpenChange: (open: boolean) => void;
}

/** Virgüllü/noktalı sayıyı parse et ("12,5" → 12.5). Geçersiz → null. */
function parseKg(raw: string): number | null {
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Çuval brüt tartısı — ELLE GİRİŞ yolu (⌄ → "Elle kg gir").
 *
 * Normal akış araç çubuğundaki "Tart" tuşudur: kantardan okur ve DOĞRUDAN kaydeder,
 * bu diyalog hiç açılmaz (`useSackWeighAction`). Burası kantar yokken/bozukken
 * kullanılan kaçış yoludur — o yüzden içinde "Tart" butonu YOK (tek dokunuş yolu
 * araç çubuğunda; iki yer iki farklı davranış anlamına gelirdi).
 *
 * İçerik değişince kg bayatlar (backend sıfırlar) → yeniden girilir.
 */
export function WeighSackDialog({ sack, onOpenChange }: Props) {
  const qc = useQueryClient();
  const open = !!sack;
  const [kg, setKg] = useState("");

  // ⚠️ Bağımlılık PRİMİTİF olmalı (D6): çağıran `sack`'i her render'da YENİ bir
  // object literal olarak veriyor (`SackEditorView`: `sack={open && data ? {...} : null}`)
  // → `[sack]` ile effect HER RENDER koşuyor ve operatör "24,5" yazarken herhangi bir
  // üst-render (tartı spinner'ı, `invalidateSackHub` sonrası refetch) girdisini SİLİYORDU.
  // Doğru emsal aynı klasörde: `SackNoteDialog` `[sack?.id, saved]` kullanıyor.
  useEffect(() => {
    if (sack) setKg(sack.weightKg != null ? String(sack.weightKg) : "");
    // `sack`'i bağımlılığa eklemek TAM OLARAK düzeltilen hatadır (yeni obje referansı).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sack?.id, sack?.weightKg]);

  const weightKg = parseKg(kg);
  const invalid = kg.trim() !== "" && weightKg === null;

  const mut = useMutation({
    // `source: MANUAL` — bu diyalog ELLE giriş yoludur ve simüle kantar korumasından
    // MUAFTIR (operatör değeri kendi yazdı; kantarın simüle olması onu ilgilendirmez).
    // Kantarsız/arızalı durumun kaçış yolu budur.
    mutationFn: () => sackHubService.weighSack(sack!.id, weightKg!, "MANUAL"),
    onSuccess: (res) => {
      toastServerSuccess(res, `Çuval ${sack!.sackNo} tartıldı`);
      invalidateSackHub(qc);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" /> Çuval {sack?.sackNo} — Elle Brüt Tartı
          </DialogTitle>
          <DialogDescription>
            Kantar okunamadığında kullanılır. Kantar çalışıyorsa “Tart” tuşu yeterli.
          </DialogDescription>
        </DialogHeader>

        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Brüt Tartı (kg)</span>
          <Input
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            inputMode="decimal"
            placeholder="örn. 24,5"
            autoFocus
          />
          {invalid && <span className="mt-1 block text-xs text-destructive">Geçerli bir kg girin.</span>}
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            İptal
          </Button>
          <Button disabled={weightKg === null || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "..." : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
