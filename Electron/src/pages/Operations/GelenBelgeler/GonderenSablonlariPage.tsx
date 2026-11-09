// BELGE TİPLERİ (eski adı "Gönderen Şablonları"; URL aynı) — tanıtılan belge tipleri + fabrikaya özgü bağ (gönderen cari,
// varsayılan sahip, parti no alanı). Düzenle fotoğrafsız (PATCH `/tanim`), Sıfırla önizlemeli ve geri alınabilir (pasife alma).
// Hazır (dosya) tipler yalnız varsa listelenir (paket yalnız GENEL yedeği taşır; boş bölüm yanıltıyordu). İzin `gelen-belge:template`.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronDown, RotateCcw } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { INCOMING_DOCUMENT_QUERY_KEY, listSenderTemplates, updateSenderTemplate } from "./service";
import type { SenderTemplatePatch, SenderTemplateView } from "./types";
import { listUserTemplates, USER_TEMPLATES_QUERY_KEY } from "./tanit/service";
import { SablonSifirlaDialog } from "./tanit/SablonSifirlaDialog";
import { isUserTemplate, TemplateCard, UnusedRow } from "./BelgeTipiKarti";

export const SENDER_TEMPLATES_PATH = "/operations/gelen-belgeler/sablonlar";
export const DOCUMENT_TYPES_TITLE = "Belge Tipleri";
const QUERY_KEY = [INCOMING_DOCUMENT_QUERY_KEY, "sablonlar"] as const;

function UnusedSection({ rows, render }: { rows: SenderTemplateView[]; render: (r: SenderTemplateView) => ReactNode }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <section className="rounded-lg border" data-testid="unused-templates">
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>
        Kullanılmayan tipler ({rows.length})
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="divide-y border-t">
          <p className="px-3 py-2 text-xs text-muted-foreground">Bu tipler belge tanımaz. Eski belgeler ve okumalar etkilenmez; "Geri al" tipi yeniden kullanıma açar.</p>
          {rows.map(render)}
        </div>
      )}
    </section>
  );
}

function useTemplates() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: QUERY_KEY, queryFn: listSenderTemplates });
  const user = useQuery({ queryKey: USER_TEMPLATES_QUERY_KEY, queryFn: listUserTemplates });
  const update = useMutation({
    mutationFn: ({ code, patch }: { code: string; patch: SenderTemplatePatch }) => updateSenderTemplate(code, patch),
    // Hata toast'u apiClient'ta; liste her durumda sunucudan tazelenir (409 sonrası güncel hâl görünsün).
    onSettled: () => void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] }),
  });
  const templates = new Map((user.data ?? []).map((u) => [u.code, u.template]));
  return { list, update, templates };
}

export function SenderTemplatesPage() {
  const { list, update, templates } = useTemplates();
  const [reset, setReset] = useState<{ codes: string[]; multi: boolean } | null>(null);
  const rows = list.data ?? [];
  const active = rows.filter((r) => r.isActive && (isUserTemplate(r) || r.inFile));
  const userRows = active.filter(isUserTemplate);
  const fileRows = active.filter((r) => !isUserTemplate(r));
  const unused = rows.filter((r) => !active.includes(r));
  const props = (row: SenderTemplateView) => ({ row, busy: update.isPending && update.variables?.code === row.code, onPatch: (patch: SenderTemplatePatch) => update.mutate({ code: row.code, patch }) });
  const card = (row: SenderTemplateView) => (
    <TemplateCard key={row.code} {...props(row)} template={templates.get(row.code) ?? null} onReset={() => setReset({ codes: [row.code], multi: false })} />
  );

  return (
    <PageShell>
      <PageHeader
        title={DOCUMENT_TYPES_TITLE}
        description="Tanıtılan belge tipleri. Tipe bağlanan gönderen cari, o tipte okunan taslakta gönderen önerisi olur. Düzenle fotoğrafsızdır; Sıfırla tipi unutturur, geri alınabilir."
        actions={
          <div className="flex flex-wrap gap-2">
            {userRows.length > 1 && (
              <Button variant="outline" onClick={() => setReset({ codes: userRows.map((r) => r.code), multi: true })} data-testid="templates-reset-many">
                <RotateCcw className="mr-1 h-4 w-4" /> Birden çok tipi sıfırla
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/operations/gelen-belgeler"><ArrowLeft className="mr-1 h-4 w-4" /> Gelen Belgeler</Link>
            </Button>
          </div>
        }
      />
      <PageBody className="min-h-0 space-y-3 p-4 sm:p-6">
        {list.isLoading ? (
          <div className="text-sm text-muted-foreground">Yükleniyor…</div>
        ) : list.isError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">Belge tipleri yüklenemedi.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void list.refetch()}>Tekrar dene</Button>
          </div>
        ) : (
          <>
            {userRows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="user-templates-empty">
                Henüz tanıtılmış belge tipi yok. Yeni tip: menüden "Belge Tanıt" ya da okunmuş bir belgenin detayında "Bu belgeyi tanıt".
              </div>
            ) : userRows.map(card)}
            {fileRows.length > 0 && <h2 className="pt-3 text-sm font-semibold" data-testid="file-templates-heading">Hazır belge tipleri</h2>}
            {fileRows.map(card)}
            <UnusedSection rows={unused} render={(r) => <UnusedRow key={r.code} {...props(r)} />} />
          </>
        )}
      </PageBody>
      {reset && <SablonSifirlaDialog codes={reset.codes} multi={reset.multi} onOpenChange={(o) => !o && setReset(null)} />}
    </PageShell>
  );
}
