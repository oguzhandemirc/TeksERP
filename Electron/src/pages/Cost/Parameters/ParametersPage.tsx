// =============================================================================
// MALİYET › PARAMETRELER (MAL-3, plan §5) — yürürlükteki + taslak yan yana, fark vurgulu.
// Yürürlüğe alma eski seti SUPERSEDED yapar; mevcut standart maliyet sürümleri ve teklifler DEĞİŞMEZ.
// Görüntüleme `cost:read`; taslak/yürürlüğe alma `cost:settings` (backend uçlarıyla birebir).
// =============================================================================
import { useState } from "react";
import { CheckCircle2, FilePlus2, Save, Trash2 } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { CostQueryError } from "../shared/CostQueryState";
import { ParameterCompareTable } from "./ParameterCompareTable";
import { ParameterConfirms } from "./ParameterConfirms";
import { PickRateRow } from "./PickRateRow";
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
    <div className="flex flex-wrap gap-2">
      {!draft && (
        <Button onClick={() => s.create.mutate()} disabled={s.create.isPending}>
          <FilePlus2 className="mr-1 h-4 w-4" />{active ? "Taslak oluştur" : "İlk seti taslak olarak kaydet"}
        </Button>
      )}
      {draft && (
        <>
          <Button variant="outline" onClick={() => s.save.mutate()} disabled={!s.dirty || s.save.isPending}><Save className="mr-1 h-4 w-4" />Kaydet</Button>
          <Button onClick={() => setConfirm("activate")} disabled={s.dirty}><CheckCircle2 className="mr-1 h-4 w-4" />Yürürlüğe al</Button>
          <Button variant="ghost" className="text-destructive" onClick={() => setConfirm("delete")}><Trash2 className="mr-1 h-4 w-4" />Taslağı sil</Button>
        </>
      )}
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title="Maliyet Parametreleri"
        description="Tesisin saat ücretleri, enerji, varsayılan fireler, genel gider ve kâr. Değişiklik taslakta yapılır, yürürlüğe alınınca yeni sürüm olur."
        actions={actions || undefined}
      />
      <PageBody className="space-y-3 p-4 sm:p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : error ? (
          <CostQueryError error={error} what="Parametre setleri" onRetry={() => { void s.active.refetch(); void s.draft.refetch(); }} />
        ) : (
          <>
            <StatusLine activeVersion={active?.versionNo} activatedAt={active?.activatedAt} draftVersion={draft?.versionNo} dirty={s.dirty} />
            {!active && !draft && !canEdit ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Yürürlükte parametre seti yok — maliyet hesaplanamaz. Ayar izni (`cost:settings`) olan biri bir set yürürlüğe almalı.
              </div>
            ) : (
              <ParameterCompareTable
                active={active}
                form={showForm ? s.form : null}
                draftLabel={draft ? `Taslak (v${draft.versionNo})` : "Yeni set"}
                editable={canEdit}
                onChange={s.setField}
              />
            )}
            {s.pickVisible && (active || showForm) && (
              <PickRateRow active={active} draft={showForm ? s.pick : null} editable={canEdit} onChange={s.setPick} />
            )}
            {showForm && canEdit && (
              <label className="block max-w-xl text-sm">
                <span className="text-muted-foreground">Not (neden değişti?)</span>
                <Input className="mt-1" maxLength={PARAM_NOTE_MAX} value={s.note} onChange={(e) => s.setNote(e.target.value)} />
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

function StatusLine({ activeVersion, activatedAt, draftVersion, dirty }: { activeVersion?: number; activatedAt?: string | null; draftVersion?: number; dirty: boolean }) {
  return (
    <p className="text-sm text-muted-foreground">
      {activeVersion ? `Yürürlükte: v${activeVersion} (${fmtFactoryDateTime(activatedAt ?? null)})` : "Yürürlükte parametre seti yok."}
      {draftVersion ? ` · Açık taslak: v${draftVersion}` : ""}
      {dirty ? " · Kaydedilmemiş değişiklik var (yürürlüğe almadan önce kaydedin)." : ""}
    </p>
  );
}
