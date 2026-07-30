import { Download, ClipboardCopy, MoreVertical, DatabaseZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { safeFormat } from "@/lib/format";
import { fmtBytes } from "../ServerStatus/serverHealth";
import type { BackupFileInfo, BackupKind } from "./service";

/**
 * Yedek türü rozeti. Gerçek bir ihtiyaç: liste mtime'a göre sıralı olduğu için
 * taze bir `pre-restore_` dosyası en üstte oturur ve "en yeni gece yedeği"
 * sanılabilir — operatör yanlış dosyaya dönebilir.
 */
const KIND_META: Record<BackupKind, { label: string; variant: "default" | "secondary" | "outline" }> = {
  nightly: { label: "Gece", variant: "secondary" },
  premigrate: { label: "Migration öncesi", variant: "outline" },
  "pre-restore": { label: "Geri yükleme öncesi", variant: "outline" },
  other: { label: "Elle eklenmiş", variant: "outline" },
};

export function BackupsTable({
  files,
  isLoading,
  isError,
  onDownload,
  onRestore,
  onRestoreToCopy,
}: {
  files: BackupFileInfo[];
  isLoading: boolean;
  isError: boolean;
  onDownload: (name: string) => void;
  /** Yerine-yazma akışı (etki önizlemesi + komut). */
  onRestore: (name: string) => void;
  /** Kopyaya geri yükleme sayfasına yönlendirir (canlıya dokunmaz). */
  onRestoreToCopy: (name: string) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Dosya</TableHead>
              <TableHead className="w-40">Tür</TableHead>
              <TableHead className="w-28">Boyut</TableHead>
              <TableHead className="w-44">Tarih</TableHead>
              <TableHead className="w-56 text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Yükleniyor…
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-destructive">
                  Yedek listesi alınamadı.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && files.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Henüz yedek yok.
                </TableCell>
              </TableRow>
            )}
            {files.map((f) => {
              const meta = KIND_META[f.kind] ?? KIND_META.other;
              return (
                <TableRow key={f.name}>
                  <TableCell className="font-mono text-xs">{f.name}</TableCell>
                  <TableCell>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{fmtBytes(f.sizeBytes)}</TableCell>
                  <TableCell className="tabular-nums">
                    {safeFormat(f.time, "dd.MM.yyyy HH:mm")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => onDownload(f.name)}>
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        İndir
                      </Button>
                      {/* Üç aksiyon `w-56` hücreye sığmaz → yıkıcı olan ikisi menüde. */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" title="Geri yükleme seçenekleri">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-72">
                          <DropdownMenuItem onSelect={() => onRestoreToCopy(f.name)}>
                            <DatabaseZap className="mr-2 h-4 w-4" />
                            <div>
                              <div>Yeni veritabanına geri yükle…</div>
                              <div className="text-xs text-muted-foreground">
                                Canlıya dokunmaz, geri alınabilir
                              </div>
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => onRestore(f.name)}>
                            <ClipboardCopy className="mr-2 h-4 w-4" />
                            <div>
                              <div>Geri yükle (üzerine yaz)…</div>
                              <div className="text-xs text-muted-foreground">
                                Canlı veritabanını değiştirir
                              </div>
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
