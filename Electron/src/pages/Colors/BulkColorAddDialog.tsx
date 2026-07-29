import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { Color } from "./types";

interface ParsedLine {
  raw: string;
  name: string;
  hex: string | null;
}

/** Satır formatı: `renk adı [#RRGGBB]` — hex satır sonunda opsiyonel. */
function parseLines(text: string): ParsedLine[] {
  return text
    .split("\n")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/#([0-9a-fA-F]{6})\s*$/);
      const hex = m ? `#${m[1]}` : null;
      const name = (m ? raw.slice(0, m.index) : raw).trim();
      return { raw, name, hex };
    })
    .filter((l) => l.name.length > 0);
}

/**
 * Saha #12: toplu renk ekleme — her satır bir renk (`ad [#RRGGBB]`). Sırayla
 * tek tek POST edilir (backend normalize + audit her kayıt için çalışır);
 * başarısızlar satır satır raporlanır, başarılılar listeden düşer.
 */
export function BulkColorAddDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [failures, setFailures] = useState<string[]>([]);

  const lines = parseLines(text);

  const bulkMut = useMutation({
    mutationFn: async () => {
      const failed: string[] = [];
      let created = 0;
      for (const line of lines) {
        try {
          // suppressErrorToast: satır-başı 409/400 zaten aşağıda inline listeye
          // düşüyor — global interceptor toast'ı "toast yağmuru" yapmasın.
          await apiClient.post<ApiResponse<Color>>(
            "/api/colors",
            {
              // Kod backend'de üretilir (RNK+GGAAYY+NNNN) — istemci göndermez.
              name: line.name,
              hex: line.hex,
              isActive: true,
            },
            { suppressErrorToast: true },
          );
          created++;
        } catch (e) {
          const msg =
            (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
            "kaydedilemedi";
          failed.push(`${line.raw} — ${msg}`);
        }
      }
      return { created, failed };
    },
    onSuccess: ({ created, failed }) => {
      void qc.invalidateQueries({ queryKey: ["colors"] });
      if (created > 0) toast.success(`${created} renk eklendi`);
      setFailures(failed);
      if (failed.length === 0) {
        setOpen(false);
        setText("");
      } else {
        // Başarısız satırlar düzeltilebilsin diye textarea'da yalnız onlar kalır.
        setText(failed.map((f) => f.split(" — ")[0]).join("\n"));
        toast.error(`${failed.length} satır eklenemedi — listede kaldı`);
      }
    },
  });

  return (
    <PermissionGate permission="property:write">
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Layers className="h-3.5 w-3.5" />
        Toplu Ekle
      </Button>
      <Dialog open={open} onOpenChange={(o) => !bulkMut.isPending && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Toplu Renk Ekle</DialogTitle>
            <DialogDescription>
              Her satıra bir renk yaz — satır sonuna istersen <span className="font-mono">#RRGGBB</span>{" "}
              ekle. Adlar otomatik standarda çevrilir (BÜYÜK, sayılar başta: "beyaz 055" → "055 BEYAZ").
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={"beyaz 055 #FFFFFF\nkrem gümüş\nlacivert 12"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {failures.length > 0 && (
            <div className="max-h-28 overflow-auto rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {failures.map((f, i) => (
                <div key={i}>{f}</div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={bulkMut.isPending}>
              Vazgeç
            </Button>
            <Button
              onClick={() => bulkMut.mutate()}
              disabled={lines.length === 0 || bulkMut.isPending}
              className="gap-2"
            >
              {bulkMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {lines.length > 0 ? `${lines.length} Rengi Ekle` : "Ekle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PermissionGate>
  );
}
