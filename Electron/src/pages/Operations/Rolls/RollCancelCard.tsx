import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Tags, Undo2, Info } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { safeFormat } from "@/lib/format";
import { rollService } from "./service";
import type { Roll } from "./types";

/**
 * İPTAL EDİLMİŞ TOP — "neden öldü, kâğıdı nerede, geri alabilir miyim".
 *
 * Panel eskiden yalnız gri bir "İptal Edildi" rozeti gösteriyordu. Rozet olayı
 * SÖYLER ama hikâyeyi anlatmaz; oysa iptal edilmiş bir kaydı inceleyen kişinin
 * ilk üç sorusu kim/ne zaman/neden'dir ve dördüncüsü "düzeltebilir miyim".
 *
 * ⚠️ ETİKET UYARISI ayrı bir satır olarak durur ve bilinçlidir: kayıt ölse de
 * KÂĞIT sahada durur. 2026-08-05'te tam bu boşluktan geçildi — T050826H0033
 * iptal edildi, etiketi topun üstünde kaldı, aynı mal saatler sonra ikinci bir
 * barkodla yeniden girildi ve depoya iki kimlikli bir top döndü.
 *
 * ⚠️ `canRestore` BACKEND'DEN gelir (`roll-cancel-restore.helper` ile aynı
 * yüklem). Burada yeniden hesaplanırsa buton çizilir ama uç 409 verir.
 */
export function RollCancelCard({ roll }: { roll: Roll }) {
  const qc = useQueryClient();

  const restore = useMutation({
    mutationFn: () => rollService.restoreCancel(roll.id),
    onSuccess: (res) => {
      toast.success(res.message ?? "İptal geri alındı");
      // Hem detay hem listeler tazelenir — top artık başka bir sekmede yaşıyor.
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["roll", roll.id] });
    },
    // onError YOK: apiClient interceptor'ı 4xx'te backend mesajını zaten
    // toast'lar (çift toast olurdu — Electron/CLAUDE.md kuralı).
  });

  const who = roll.cancelledBy?.fullName ?? roll.cancelledBy?.username ?? null;

  return (
    <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
          <Tags className="h-3.5 w-3.5" /> İptal Bilgisi
        </div>

        <div className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1.5 text-sm">
          <div className="text-xs text-muted-foreground">İptal Tarihi</div>
          <div className="text-xs">{roll.cancelledAt ? safeFormat(roll.cancelledAt, "dd.MM.yyyy HH:mm") : "—"}</div>
          {who && (
            <>
              <div className="text-xs text-muted-foreground">İptal Eden</div>
              <div className="text-xs">{who}</div>
            </>
          )}
          <div className="text-xs text-muted-foreground">Sebep</div>
          <div className="text-xs">
            {roll.cancelReason ?? (
              /* Sebep yalnız ETİKETLİ iptalde zorunlu; eski kayıtlar da boş. */
              <span className="text-muted-foreground">Belirtilmemiş</span>
            )}
          </div>
        </div>

        {roll.labelPrintedAt && (
          <div className="rounded-md border border-amber-300 bg-amber-100/70 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            Bu topun etiketi <strong>{safeFormat(roll.labelPrintedAt, "dd.MM.yyyy HH:mm")}</strong> tarihinde basıldı —
            kâğıt fiziksel olarak topun üstünde olabilir. Sahada bulunursa{" "}
            <strong>sökülmeli</strong>; yoksa okutulmaya devam eder ve her seferinde reddedilir.
          </div>
        )}

        {roll.canRestore ? (
          <PermissionGate anyOf={["roll:write"]}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Bu kayıt hiç işlem görmemiş — iptal geri alınabilir.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => restore.mutate()}
                disabled={restore.isPending}
              >
                <Undo2 className="h-3.5 w-3.5" />
                {restore.isPending ? "Geri alınıyor…" : "İptali Geri Al"}
              </Button>
            </div>
          </PermissionGate>
        ) : roll.restoreBlockReason ? (
          /* Sessiz "buton yok" DEĞİL: neden geri alınamadığını söylemek,
             kullanıcıyı doğru yola (süpervizör / farklı işlem) yönlendirir. */
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{roll.restoreBlockReason}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
