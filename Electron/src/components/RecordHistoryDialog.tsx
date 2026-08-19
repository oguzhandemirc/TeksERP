import { useQuery } from "@tanstack/react-query";
import { History, Loader2, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { safeFormat } from "@/lib/format";
import { systemLogService } from "@/services/systemLogService";
import { AuditChangeList } from "@/components/AuditChangeList";

// =============================================================================
// TEK KAYDIN DEĞİŞİKLİK GEÇMİŞİ (Faz C, 2026-08-19)
// =============================================================================
// Tasarım: docs/design/AUDIT-DERINLESTIRME-TASARIM.md
//
// ⓘ düğmesinin İKİNCİ katmanı: birincisi "kim/ne zaman" (kaydın künye
// kolonlarından, asla boş dönmez), bu ise "TAM OLARAK NE DEĞİŞTİ".
//
// Veri `system_logs.changes` alanından gelir (Faz B2 — alan bazlı diff).
// ⚠️ ESKİ KAYITLARDA `changes` YOK: Faz B2 öncesi audit satırları yalnız
// ad-hoc `newData` taşıyor. Bunu "değişiklik yok" diye göstermek YANLIŞ olur →
// açıkça "ayrıntı kaydedilmemiş" denir. Veriyi kaybettiğimizi gizlemek, boş
// satır göstermekten kötüdür.
//
// ⚠️ 6 aydan eski kayıtlar arşive taşınır ve bu liste SICAK tabloyu okur.
// Arşiv sorgusu ayrı bir uçtur; burada "daha eski kayıtlar arşivde" denir.
// =============================================================================

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Audit tablo adı (WORK_ORDER, CUSTOMER…). */
  table: string;
  id: string;
  title?: string;
}

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Oluşturuldu",
  UPDATE: "Değiştirildi",
  DELETE: "Silindi",
};

export function RecordHistoryDialog({ open, onOpenChange, table, id, title }: Props) {
  const q = useQuery({
    queryKey: ["record-history", table, id],
    queryFn: () => systemLogService.list({ tableName: table, recordId: id, limit: 100 }),
    enabled: open,
    staleTime: 60_000,
  });
  const rows = q.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Değişiklik Geçmişi
          </DialogTitle>
          <DialogDescription>
            {title ? `${title} · ` : ""}En yeniden eskiye. 6 aydan eski kayıtlar arşivlenir.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {q.isLoading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> yükleniyor…
            </div>
          )}
          {q.isError && <div className="py-6 text-sm text-destructive">Geçmiş alınamadı.</div>}
          {!q.isLoading && rows.length === 0 && (
            <div className="rounded border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Bu kayıt için işlem kaydı bulunamadı — 6 aydan eskiyse arşivlenmiş olabilir.
            </div>
          )}

          {rows.map((r) => (
            <div key={r.id} className="rounded-md border p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={r.action === "DELETE" ? "destructive" : "secondary"}>
                  {ACTION_LABEL[r.action] ?? r.action}
                </Badge>
                <span className="font-medium">
                  {r.user?.fullName?.trim() || r.user?.username || "—"}
                </span>
                <span className="text-muted-foreground">
                  {safeFormat(r.createdAt, "dd.MM.yyyy HH:mm")}
                </span>
                {/* Cihaz (Faz B3) — sahada 10 tablet aynı kullanıcıyla çalışıyor,
                    "hangi tabletten" sorusunu yalnız bu cevaplar. */}
                {r.deviceId && (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    title={`Cihaz: ${r.deviceId}`}
                  >
                    <Smartphone className="h-2.5 w-2.5" />
                    {r.deviceId}
                  </span>
                )}
              </div>

              {/* Alan-bazlı değişiklikler (Faz B2). */}
              {r.changes && r.changes.length > 0 ? (
                <div className="mt-1.5 text-[11px]">
                  <AuditChangeList changes={r.changes} />
                </div>
              ) : r.action === "UPDATE" ? (
                // Faz B2 ÖNCESİ kayıt: ayrıntı hiç yazılmamış. "Değişiklik yok"
                // demek yanlış olurdu — veriyi kaybettiğimizi açıkça söylüyoruz.
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Değişiklik ayrıntısı kaydedilmemiş (eski kayıt).
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
