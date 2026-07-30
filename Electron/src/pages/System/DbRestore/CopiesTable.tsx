import { ShieldCheck, Trash2, ArrowRightLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { safeFormat } from "@/lib/format";
import { fmtBytes } from "../ServerStatus/serverHealth";
import type { CopyState, DbCopy } from "./types";

const STATE_META: Record<
  CopyState,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive"; hint?: string }
> = {
  queued: { label: "Sırada", variant: "secondary" },
  creating: { label: "Oluşturuluyor", variant: "secondary" },
  restoring: { label: "Geri yükleniyor", variant: "secondary" },
  verifying: { label: "Doğrulanıyor", variant: "secondary" },
  ready: { label: "Hazır", variant: "default" },
  failed: { label: "Başarısız", variant: "destructive" },
  // Süreç iş sırasında yeniden başlamış: kopya YARIM olabilir ve tam bir kopyadan
  // ayırt edilemez → geçiş SUNULMAZ.
  interrupted: { label: "Yarıda kaldı", variant: "destructive", hint: "Silip yeniden oluşturun" },
  // Veritabanı var ama kaydı yok (örn. takas sonrası kayıt yedeğin içeriğine döndü).
  unverified: { label: "Doğrulanmamış", variant: "outline", hint: "Önce doğrulayın" },
};

export function CopiesTable({
  copies,
  busyName,
  onVerify,
  onDrop,
  onSwap,
}: {
  copies: DbCopy[];
  busyName: string | null;
  onVerify: (name: string) => void;
  onDrop: (copy: DbCopy) => void;
  onSwap: (name: string) => void;
}) {
  if (copies.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Henüz kopya yok. Bir yedek seçip "Kopya oluştur" ile başlayın.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Veritabanı</TableHead>
              <TableHead className="w-40">Durum</TableHead>
              <TableHead className="w-28">Boyut</TableHead>
              <TableHead className="w-40">Oluşturuldu</TableHead>
              <TableHead className="w-64 text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {copies.map((c) => {
              const meta = STATE_META[c.state];
              const busy = busyName === c.name;
              const canSwap = c.state === "ready";
              return (
                <TableRow key={c.name}>
                  <TableCell>
                    <div className="font-mono text-xs">{c.name}</div>
                    {c.sourceBackup && (
                      <div className="text-[11px] text-muted-foreground">
                        kaynak: {c.sourceBackup}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    {meta.hint && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{meta.hint}</div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {c.sizeBytes === null ? "—" : fmtBytes(c.sizeBytes)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {c.createdAt ? safeFormat(c.createdAt, "dd.MM.yyyy HH:mm") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => onVerify(c.name)}
                        title="Doğrulamayı yeniden çalıştır"
                      >
                        {busy ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canSwap || busy}
                        onClick={() => onSwap(c.name)}
                        title={
                          canSwap
                            ? "Takas komutunu hazırla"
                            : "Yalnız doğrulanmış (hazır) kopyaya geçiş yapılabilir"
                        }
                      >
                        <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
                        Geçiş
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => onDrop(c)}
                        title="Kopyayı sil"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
