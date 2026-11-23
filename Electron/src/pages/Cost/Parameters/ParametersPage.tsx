// =============================================================================
// MALİYET › PARAMETRELER (MAL-3, plan §5) — yürürlükteki + taslak yan yana, fark vurgulu.
// Yürürlüğe alma eski seti SUPERSEDED yapar; mevcut standart maliyet sürümleri ve teklifler DEĞİŞMEZ.
// Görüntüleme `cost:read`; taslak/yürürlüğe alma `cost:settings` (backend uçlarıyla birebir).
// =============================================================================
import { useState } from "react";
import { CheckCircle2, FilePlus2, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { CostQueryError } from "../shared/CostQueryState";
import { ParameterConfirms } from "./ParameterConfirms";
import { ParameterGroupCards } from "./ParameterGroupCards";
import { PARAM_NOTE_MAX } from "./schema";
import { useParameterSets } from "./useParameterSets";

export function ParametersPage() {
  const { hasPermission } = useRoleAccess();
  const canEdit = hasPermission("cost:settings");
  const s = useParameterSets();
  const [confirm, setConfirm] = useState<"activate" | "delete" | null>(null);
  const loading = s.active.isLoading || s.draft.isLoading;
  const error = s.active.error ?? s.draft.error;
  const active = s.active.data ?? null;
  const draft = s.draftRow;
  // Yürürlükte set yoksa ilk set formla doğar: taslak sütunu yerel "yeni set" olarak çizilir.
  const showForm = !!draft || (!active && canEdit);

  const actions = canEdit && !loading && !error && (
    <>
      {!draft && (
        <Button onClick={() => s.create.mutate()} disabled={s.create.isPending}
          title="Yürürlükteki değerlerin kopyasıyla düzenlenebilir bir taslak açar; yürürlüğe alınana kadar hesapları etkilemez.">
          <FilePlus2 className="mr-1 h-4 w-4" />{active ? "Değişiklik için taslak aç" : "İlk seti taslak olarak kaydet"}
        </Button>
      )}
      {draft && (
        <>
          <Button variant="destructive" onClick={() => setConfirm("delete")}><Trash2 className="mr-1 h-4 w-4" />Taslağı sil</Button>
          <Button onClick={() => s.save.mutate()} disabled={!s.dirty || s.save.isPending}><Save className="mr-1 h-4 w-4" />Kaydet</Button>
          <Button onClick={() => setConfirm("activate")} disabled={s.dirty} title={s.dirty ? "Önce değişiklikleri kaydedin" : undefined}>
            <CheckCircle2 className="mr-1 h-4 w-4" />Yürürlüğe al
          </Button>
        </>
      )}
    </>
  );

  const badges = !loading && !error && (
    <span className="flex items-center gap-1.5">
      {active && <Badge variant="soft" title={`Yürürlüğe alındı: ${fmtFactoryDateTime(active.activatedAt ?? null)}`}>v{active.versionNo} yürürlükte</Badge>}
      {draft && <Badge variant="warning">Açık taslak v{draft.versionNo}</Badge>}
    </span>
  );

  return (
    <PageShell>
      <PageHeader
        title="Maliyet Parametreleri"
        titleExtra={badges || undefined}
        description="Tesisin saat ücretleri, enerji, varsayılan fireler, genel gider ve kâr. Değişiklik taslakta yapılır, yürürlüğe alınınca yeni sürüm olur."
        statusLine={s.dirty ? <span className="text-warning-soft-foreground">Kaydedilmemiş değişiklik var — yürürlüğe almadan önce kaydedin.</span> : undefined}
        actions={actions || undefined}
      />
      <PageBody className="space-y-4 p-4 sm:p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : error ? (
          <CostQueryError error={error} what="Parametre setleri" onRetry={() => { void s.active.refetch(); void s.draft.refetch(); }} />
        ) : !active && !draft && !canEdit ? (
          <EmptyState icon={SlidersHorizontal} title="Yürürlükte parametre seti yok"
            description="Maliyet hesaplanamaz. Maliyet ayarı izni olan biri bir set yürürlüğe almalı." />
        ) : (
          <>
            <ParameterGroupCards
              active={active}
              form={showForm ? s.form : null}
              draftLabel={draft ? `Taslak (v${draft.versionNo})` : "Yeni set"}
              editable={canEdit}
              onChange={s.setField}
              pick={s.pickVisible ? { draft: s.pick, onChange: s.setPick } : null}
            />
            {showForm && canEdit && (
              <label className="block max-w-xl rounded-xl border bg-card p-4 text-sm shadow-soft">
                <span className="font-semibold">Değişiklik notu</span>
                <Input className="mt-2" maxLength={PARAM_NOTE_MAX} placeholder="Neden değişti?" value={s.note} onChange={(e) => s.setNote(e.target.value)} />
              </label>
            )}
          </>
        )}
      </PageBody>
      <ParameterConfirms which={confirm} draftVersion={draft?.versionNo} onClose={() => setConfirm(null)}
        activate={s.activate} remove={s.remove} />
    </PageShell>
  );
}
