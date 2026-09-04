import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";

import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { cn } from "@/lib/utils";
import { isDarkHex, sackTagService, type SackTag } from "./service";
import { SackTagDialog } from "./SackTagDialog";

// =============================================================================
// ÇUVAL İZLERİ (ETİKET KATALOĞU) — 2026-09-04
// =============================================================================
// Paketlemeci çuvala "buna bir şey daha eklenecek" / "bunu kontrol et" izi
// bırakır (macOS Finder etiketi emsali). Bu ekran o izlerin KATALOĞUDUR.
//
// ── İZİN FORMÜLÜ (ReasonPresets kalıbı) ────────────────────────────────────
// Okuma `shipping:read` (karo + route AYNI kodu taşır — ayrışırsa kullanıcı
// karta tıklar ve /forbidden'a düşer), YAZMA `shipping:write` ve o kontrol
// SAYFANIN İÇİNDE yapılır: yetkisi olmayan ekranı GÖRÜR, düzenleme tuşları
// ÇİZİLMEZ (gri buton olmayan bir yolu vaat eder). Yeni izin kodu ÜRETİLMEDİ.
//
// ── SİLME İSTİSNADIR ───────────────────────────────────────────────────────
// Katalogdan çıkarmanın doğru yolu "Pasif": atamalar KALIR, rozet soluk
// çizilir, yeni atamaya kapanır. Sert silme yalnız HİÇ KULLANILMAMIŞ etiket
// için mümkün ve bunu DB seddi (FK Restrict) garanti eder — kullanımdaki
// etikette sunucu Türkçe 409 döner, ekran o mesajı AYNEN gösterir.
// =============================================================================

export function SackTagsPage() {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canEdit = hasPermission("shipping:write");
  const [dialog, setDialog] = useState<{ tag: SackTag | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SackTag | null>(null);

  const q = useQuery({
    queryKey: ["sack-tags", "all"],
    queryFn: () => sackTagService.list(true),
    staleTime: 60_000,
  });

  const rows = useMemo(
    () => [...(q.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr")),
    [q.data],
  );

  const invalidate = () => {
    // ⚠️ İKİ ANAHTAR: katalog ekranı ("sack-tags") ve liste süzgeci lookup'ı
    // aynı veriyi ayrı önbelleklerde tutar. Yalnız birini tazelemek, süzgeçte
    // az önce eklenmiş etiketin görünmemesine yol açar.
    void qc.invalidateQueries({ queryKey: ["sack-tags"] });
    void qc.invalidateQueries({ queryKey: ["sack-search"] });
  };

  const toggleActive = useMutation({
    mutationFn: (row: SackTag) => sackTagService.update(row.id, { isActive: !row.isActive }),
    onSuccess: (row) => {
      invalidate();
      toast.success(row.isActive ? "Etiket listeye geri alındı" : "Etiket gizlendi", {
        description: row.isActive
          ? undefined
          : "Bu etiketi taşıyan çuvallar etkilenmedi — rozet soluk görünür, yeni iz bırakılamaz.",
      });
    },
    onError: (err: Error) => toast.error("İşlem yapılamadı", { description: err.message }),
  });

  /**
   * Sıra değişimi — TOPLU reorder ucu YOK (`ReasonPreset.reorder` emsalinin
   * karşılığı bu katalogda yazılmadı), o yüzden İKİ satırın `sortOrder`ı
   * takas edilir. İki yazım TEK mutasyonda ve SIRAYLA koşar: ayrı mutasyonlar
   * yarışsaydı ikisi de aynı anda tazeleme tetikler, liste bir kare eski
   * sırayla çizilir ve satır "geri zıplıyor" görünürdü.
   *
   * ⚠️ Eşit `sortOrder` (elle girilmiş satırlarda mümkün) takası ETKİSİZ
   * kılardı → o durumda hedefin bir üstüne/altına açık bir değer yazılır.
   */
  const reorder = useMutation({
    mutationFn: async ({ a, b, delta }: { a: SackTag; b: SackTag; delta: 1 | -1 }) => {
      if (a.sortOrder === b.sortOrder) {
        // Eşitlikte takas anlamsız — taşınan satır hedefin bir ötesine yazılır
        // (aşağı: +1, yukarı: −1). Yönü SATIRIN sırasından değil KOMUTTAN al.
        await sackTagService.update(a.id, { sortOrder: b.sortOrder + delta });
        return;
      }
      await sackTagService.update(a.id, { sortOrder: b.sortOrder });
      await sackTagService.update(b.id, { sortOrder: a.sortOrder });
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error("Sıra kaydedilemedi", { description: err.message }),
  });

  const remove = useMutation({
    mutationFn: (row: SackTag) => sackTagService.remove(row.id),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(null);
      toast.success("Etiket silindi");
    },
    // ⚠️ Kullanımdaki etikette sunucu 409 + "… çuvalda kullanılmış" der.
    // Mesajı AYNEN göster: operatörün bir sonraki adımı ("Pasif yap") onda yazılı.
    onError: (err: Error) => toast.error("Silinemedi", { description: err.message }),
  });

  /** Bir yukarı/aşağı taşı — komşuyla `sortOrder` takası. */
  const move = (index: number, delta: 1 | -1) => {
    const a = rows[index];
    const b = rows[index + delta];
    if (!a || !b) return;
    reorder.mutate({ a, b, delta });
  };

  return (
    <PageShell>
      <PageHeader
        title="Çuval İzleri"
        description="Paketlemede çuvala bırakılan işaretler — “kontrol edilecek”, “eklenecek var” gibi. Çuvalın içeriğini ya da tartısını DEĞİŞTİRMEZ."
        actions={
          canEdit ? (
            <Button onClick={() => setDialog({ tag: null })}>
              <Plus className="mr-2 size-4" />
              Yeni Etiket
            </Button>
          ) : undefined
        }
      />

      <PageBody className="p-6">
        <div className="space-y-3">
          <Callout tone="info">
            İz bir <b>not</b> gibidir: çuvalın ölçüsüne, içeriğine ve müşteri etiketine dokunmaz.
            Çuval <b>sevk edildiği anda izleri temizlenir</b> (sevkiyat geri alınırsa geri gelir).
            İzler yalnız fabrika içinde görünür — müşteriye giden çuval etiketine basılmaz.
          </Callout>

          {q.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
              Henüz etiket tanımlanmadı.
              {canEdit ? " “Yeni Etiket” ile başlayın." : ""}
            </div>
          ) : (
            <div className="rounded-lg border">
              {rows.map((row, i) => (
                <div key={row.id} className="flex items-center gap-3 border-b p-3 last:border-b-0">
                  <div className="flex flex-col">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={!canEdit || i === 0 || reorder.isPending}
                      onClick={() => move(i, -1)}
                      aria-label="Yukarı taşı"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={!canEdit || i === rows.length - 1 || reorder.isPending}
                      onClick={() => move(i, 1)}
                      aria-label="Aşağı taşı"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold",
                          !row.isActive && "opacity-50",
                        )}
                        style={{
                          backgroundColor: row.hex,
                          color: isDarkHex(row.hex) ? "#fff" : "#000",
                        }}
                      >
                        {row.name}
                      </span>
                      {!row.isActive && <Badge variant="outline">Gizli</Badge>}
                    </div>
                    <div className="truncate pt-1 text-xs text-muted-foreground">
                      <span className="font-mono">{row.code}</span> · {row.hex}
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDialog({ tag: row })}
                        aria-label={`${row.name} — düzenle`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={toggleActive.isPending}
                        onClick={() => toggleActive.mutate(row)}
                        aria-label={row.isActive ? `${row.name} — gizle` : `${row.name} — geri al`}
                      >
                        {row.isActive ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmDelete(row)}
                        aria-label={`${row.name} — sil`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PageBody>

      <SackTagDialog
        open={!!dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        tag={dialog?.tag ?? null}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title={`“${confirmDelete?.name ?? ""}” silinsin mi?`}
        description="Silme yalnız HİÇ KULLANILMAMIŞ etiket için mümkündür. Bir çuvalda kullanılmışsa sunucu izin vermez — o durumda “Gizle” ile listeden çıkarın; eski izler yerinde kalır."
        confirmLabel="Sil"
        destructive
        isPending={remove.isPending}
        onConfirm={() => confirmDelete && remove.mutateAsync(confirmDelete).catch(() => {})}
      />
    </PageShell>
  );
}
