import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { printDocumentArea } from "@/lib/print";
import { adminUserService, type BulkPreviewRow, type BulkResetResult } from "@/services/adminUserService";

const REASON_LABEL: Record<BulkPreviewRow["reason"], string> = {
  ANAHTAR_UYUSMUYOR: "doğrulanamıyor",
  DUZ_METIN: "düz metin",
  GECERLI: "geçerli",
};

/**
 * Toplu hızlı PIN sıfırlama — önizleme etkilenen HER kullanıcıyı listeler, kişi başı seçim
 * sunar; yeni PIN'ler yalnız bu cevapta döner ve yazdırılır.
 */
export function BulkPinResetPanel({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"uyusmayan" | "tumu">("uyusmayan");
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<BulkResetResult | null>(null);

  const previewQ = useQuery({
    queryKey: ["short-credential-bulk-preview", scope],
    queryFn: () => adminUserService.bulkResetPreview(scope),
    enabled,
  });
  const rows = useMemo(() => previewQ.data?.data.pins ?? [], [previewQ.data]);
  const reprint = previewQ.data?.data.cardsToReprint ?? [];
  const chosen = selected ?? new Set(scope === "uyusmayan" ? rows.map((r) => r.userId) : []);

  const resetMut = useMutation({
    mutationFn: () => adminUserService.bulkReset([...chosen]),
    onSuccess: (res) => {
      setConfirmOpen(false);
      setSelected(null);
      setResult(res.data);
      toast.success(`${res.data.results.length} kullanıcıya yeni hızlı PIN verildi — listeyi şimdi yazdırın.`);
      void qc.invalidateQueries({ queryKey: ["short-credential-status"] });
      void qc.invalidateQueries({ queryKey: ["short-credential-bulk-preview"] });
    },
  });

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const pickScope = (s: "uyusmayan" | "tumu") => {
    setScope(s);
    setSelected(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Toplu hızlı PIN sıfırlama</div>
        <div className="flex gap-1">
          <Button size="sm" variant={scope === "uyusmayan" ? "default" : "outline"} onClick={() => pickScope("uyusmayan")}>
            Doğrulanamayanlar
          </Button>
          <Button size="sm" variant={scope === "tumu" ? "default" : "outline"} onClick={() => pickScope("tumu")}>
            Tüm PIN'liler
          </Button>
        </div>
      </div>
      {previewQ.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <PreviewList rows={rows} chosen={chosen} onToggle={toggle} />
      )}
      {reprint.length > 0 && (
        <div className="text-xs text-amber-700 dark:text-amber-400">
          Yeniden basılması gereken kart: {reprint.map((c) => c.fullName).join(", ")} — Kullanıcı → Personel Kartı → Yeniden bas.
        </div>
      )}
      <div className="flex justify-end">
        <Button size="sm" variant="destructive" disabled={chosen.size === 0 || resetMut.isPending} onClick={() => setConfirmOpen(true)}>
          Seçilen {chosen.size} kullanıcıya yeni PIN ver
        </Button>
      </div>
      {result && result.results.length > 0 && <PinSheet result={result} />}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Toplu hızlı PIN sıfırlama"
        description={`Seçilen ${chosen.size} kullanıcının hızlı PIN'i yenilenecek; eski PIN'leri ANINDA geçersiz olur. Yeni PIN'ler yalnız bir kez gösterilecek. Devam edilsin mi?`}
        confirmLabel="Yeni PIN ver"
        destructive
        isPending={resetMut.isPending}
        onConfirm={() => resetMut.mutate()}
      />
    </div>
  );
}

function PreviewList({ rows, chosen, onToggle }: { rows: BulkPreviewRow[]; chosen: Set<string>; onToggle: (id: string) => void }) {
  if (rows.length === 0) {
    return <div className="rounded-md border bg-muted/20 p-3 text-center text-xs text-muted-foreground">Etkilenen kullanıcı yok.</div>;
  }
  return (
    <div className="max-h-64 overflow-y-auto rounded-md border">
      {rows.map((r) => (
        <label key={r.userId} className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0">
          <Checkbox checked={chosen.has(r.userId)} onCheckedChange={() => onToggle(r.userId)} />
          <span className="flex-1">
            {r.fullName} <span className="font-mono text-xs text-muted-foreground">@{r.username}</span>
          </span>
          <span className="text-xs text-muted-foreground">{REASON_LABEL[r.reason]}</span>
        </label>
      ))}
    </div>
  );
}

function PinSheet({ result }: { result: BulkResetResult }) {
  const printRef = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-2">
      <div ref={printRef} className="print-area rounded-md border bg-white p-4 text-black">
        <div className="mb-2 text-sm font-bold">Yeni hızlı PIN listesi</div>
        {result.results.map((r) => (
          <div key={r.userId} className="flex justify-between border-b py-1 text-sm last:border-b-0">
            <span>
              {r.fullName} <span className="font-mono text-xs">@{r.username}</span>
            </span>
            <span className="font-mono font-bold tracking-[0.2em]">{r.pin}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-amber-600 dark:text-amber-400">Bu liste bir daha gösterilmez — şimdi yazdırıp dağıtın.</span>
        <Button size="sm" variant="outline" onClick={() => printDocumentArea(printRef.current)}>
          <Printer className="h-3.5 w-3.5" /> Yazdır
        </Button>
      </div>
    </div>
  );
}
