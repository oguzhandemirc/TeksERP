import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, Pencil, Plus, ArrowUp, ArrowDown } from "lucide-react";

import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import {
  KIND_STORES_TEXT,
  KIND_TABS,
  reasonPresetService,
  type ReasonPreset,
  type ReasonPresetKind,
} from "./service";
import { ReasonPresetDialog, type ReasonPresetDialogMode } from "./ReasonPresetDialog";

// =============================================================================
// HAZIR SEBEPLER (2026-08-19)
// =============================================================================
// TEK EKRAN, DÖRT SEKME — bilinçli. Dört ayrı Tanımlar kartı açmak menüyü
// kalabalıklaştırırdı ve dördü de aynı şeyin (operatöre gösterilen hazır mesaj)
// dört bağlamıdır; ayrı ayrı aranacak şeyler değil.
//
// ── İZİN FORMÜLÜ ───────────────────────────────────────────────────────────
// Okuma serbest (liste zaten operatör ekranlarında görünüyor), YAZMA
// `roll:manual-adjust` ile — yani "veriyi elle düzeltebilen" süpervizör. Yeni
// bir izin kodu ÜRETİLMEDİ: sahada atanması unutulacak bir adım daha olurdu
// (2026-08-01 kurşun bypass vakası). Yetkisi olmayan kullanıcı ekranı GÖRÜR,
// düzenleme tuşları ÇİZİLMEZ — gri buton, olmayan bir yolu vaat eder.
//
// ⚠️ SİLME YOK. Gizlenen satırın kodu DB'de kalır ve geçmiş kayıtların etiketi
// çözülmeye devam eder; sistem satırı zaten bir sonraki sunucu açılışında geri
// gelirdi (rol şablonlarındaki "sert silme = diriliş" dersi).
// =============================================================================

export function ReasonPresetsPage() {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canEdit = hasPermission("roll:manual-adjust");
  const [tab, setTab] = useState<ReasonPresetKind>("ROLL_SCRAP");
  const [dialog, setDialog] = useState<{
    mode: ReasonPresetDialogMode;
    preset: ReasonPreset | null;
  } | null>(null);

  const q = useQuery({
    queryKey: ["reason-presets", "all"],
    queryFn: () => reasonPresetService.list(true),
    staleTime: 60_000,
  });

  const rows = useMemo(
    () =>
      (q.data ?? [])
        .filter((r) => r.kind === tab)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [q.data, tab],
  );

  const toggleActive = useMutation({
    mutationFn: (row: ReasonPreset) =>
      reasonPresetService.update(row.id, { isActive: !row.isActive }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["reason-presets"] });
      toast.success(row.isActive ? "Sebep listeye geri alındı" : "Sebep gizlendi", {
        description: row.isActive ? undefined : "Geçmiş kayıtlar etkilenmedi.",
      });
    },
    // Sunucu "son aktif satır gizlenemez" diyebilir — mesajı AYNEN göster.
    onError: (err: Error) => toast.error("İşlem yapılamadı", { description: err.message }),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => reasonPresetService.reorder(tab, ids),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["reason-presets"] }),
    onError: (err: Error) => toast.error("Sıra kaydedilemedi", { description: err.message }),
  });

  /** Satırı bir yukarı/aşağı taşır — sunucu TÜM listeyi sırayla bekler. */
  const move = (index: number, delta: number) => {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    reorder.mutate(next.map((r) => r.id));
  };

  const activeTab = KIND_TABS.find((t) => t.kind === tab)!;

  return (
    <PageShell>
      <PageHeader
        title="Hazır Sebepler"
        description="Operatörün tek dokunuşla seçtiği hazır mesajlar — fire, kayıt düzeltmesi, elle top ekleme ve iptal ekranlarında çıkar."
        actions={
          canEdit ? (
            <Button onClick={() => setDialog({ mode: "create", preset: null })}>
              <Plus className="mr-2 size-4" />
              Yeni Sebep
            </Button>
          ) : undefined
        }
      />

      <PageBody className="p-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ReasonPresetKind)}>
          <TabsList>
            {KIND_TABS.map((t) => (
              <TabsTrigger key={t.kind} value={t.kind}>
                {t.title}
              </TabsTrigger>
            ))}
          </TabsList>

          {KIND_TABS.map((t) => (
            <TabsContent key={t.kind} value={t.kind} className="mt-4 space-y-3">
              <Callout tone="info">{t.hint}</Callout>

              {KIND_STORES_TEXT[t.kind] && (
                <Callout tone="info" title="Bu listede kayda metin ve kod birlikte yazılır">
                  Kayıt hem görünen metni hem de satırın kodunu taşır; raporlar koda göre
                  gruplanır. Metni değiştirmek yalnız BUNDAN SONRAKİ kayıtların görünen metnini
                  değiştirir — eski kayıtlar eski metinle kalır ama kod aynı olduğu için rapor
                  bölünmez.
                </Callout>
              )}

              {q.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border">
                  {rows.map((row, i) => (
                    <div
                      key={row.id}
                      className="flex items-center gap-3 border-b p-3 last:border-b-0"
                    >
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
                            className={
                              row.isActive ? "font-medium" : "font-medium text-muted-foreground line-through"
                            }
                          >
                            {row.label}
                          </span>
                          {!row.isActive && <Badge variant="outline">Gizli</Badge>}
                          {row.requiresText && <Badge variant="secondary">Açıklama ister</Badge>}
                          {row.isSystem && <Badge variant="outline">Sistem</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          <span className="font-mono">{row.code}</span>
                          {row.fullText && row.fullText !== row.label ? ` · ${row.fullText}` : ""}
                        </div>
                      </div>

                      {canEdit && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDialog({ mode: "edit", preset: row })}
                            aria-label={`${row.label} — düzenle`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDialog({ mode: "duplicate", preset: row })}
                            aria-label={`${row.label} — çoğalt`}
                          >
                            <Copy className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={toggleActive.isPending}
                            onClick={() => toggleActive.mutate(row)}
                            aria-label={row.isActive ? `${row.label} — gizle` : `${row.label} — geri al`}
                          >
                            {row.isActive ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </PageBody>

      <ReasonPresetDialog
        open={!!dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        mode={dialog?.mode ?? "edit"}
        kind={activeTab.kind}
        preset={dialog?.preset ?? null}
      />
    </PageShell>
  );
}
