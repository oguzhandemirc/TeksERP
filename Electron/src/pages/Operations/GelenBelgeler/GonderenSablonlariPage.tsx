// BELGE TİPLERİ (eski adı "Gönderen Şablonları"; URL aynı) — tanıtılan belge tipleri + fabrikaya özgü bağ (gönderen cari,
// varsayılan sahip, parti no alanı). Düzenle fotoğrafsız (PATCH `/tanim`), Sıfırla önizlemeli ve geri alınabilir (pasife alma).
// Tablo iş emri listesiyle aynı DataTable; satır tıkı ayrıntı panelini açar. Hazır tipler yalnız varsa listelenir. İzin `gelen-belge:template`.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { ArrowLeft, Copy, PanelRight, RotateCcw } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { toast } from "sonner";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { INCOMING_DOCUMENT_QUERY_KEY, listSenderTemplates, updateSenderTemplate } from "./service";
import type { SenderTemplatePatch, SenderTemplateView } from "./types";
import { listUserTemplates, USER_TEMPLATES_QUERY_KEY } from "./tanit/service";
import { SablonSifirlaDialog } from "./tanit/SablonSifirlaDialog";
import { isUserTemplate } from "./BelgeTipiKarti";
import { belgeTipiColumns, isInUse } from "./belgeTipiColumns";
import { BelgeTipiSheet } from "./BelgeTipiSheet";

export const SENDER_TEMPLATES_PATH = "/operations/gelen-belgeler/sablonlar";
export const DOCUMENT_TYPES_TITLE = "Belge Tipleri";
const QUERY_KEY = [INCOMING_DOCUMENT_QUERY_KEY, "sablonlar"] as const;

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

function Toolbar({ showUnused, setShowUnused, unusedCount, noUserHint }: { showUnused: boolean; setShowUnused: (v: boolean) => void; unusedCount: number; noUserHint: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
      <ToolbarToggle checked={showUnused} onCheckedChange={setShowUnused} label={`Kullanılmayanları göster (${unusedCount})`} title="Pasife alınmış, sıfırlanmış ya da okuma motorunda artık olmayan tipler" />
      {noUserHint && (
        <span className="text-xs text-muted-foreground" data-testid="user-templates-empty">
          Henüz tanıtılmış belge tipi yok. Yeni tip: menüden "Belge Tanıt" ya da okunmuş bir belgenin detayında "Bu belgeyi tanıt".
        </span>
      )}
    </div>
  );
}

export function SenderTemplatesPage() {
  const { list, update, templates } = useTemplates();
  const [reset, setReset] = useState<{ codes: string[]; multi: boolean } | null>(null);
  const [showUnused, setShowUnused] = useState(false);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const rows = useMemo(() => list.data ?? [], [list.data]);
  // Liste sayfasız TEK istekte gelir (EL-15): kullanılmayanları göster anahtarı istemcide süzer.
  const active = rows.filter(isInUse);
  const userRows = active.filter(isUserTemplate);
  const unused = rows.filter((r) => !isInUse(r));
  const data = useMemo(() => {
    const inUse = rows.filter(isInUse);
    const ordered = [...inUse.filter(isUserTemplate), ...inUse.filter((r) => !isUserTemplate(r))];
    return showUnused ? [...ordered, ...rows.filter((r) => !isInUse(r))] : ordered;
  }, [rows, showUnused]);
  const busyCode = update.isPending ? (update.variables?.code ?? null) : null;
  const patch = (code: string, p: SenderTemplatePatch) => update.mutate({ code, patch: p });
  const columns = useMemo(
    () => belgeTipiColumns({ busyCode, onPatch: (code, p) => update.mutate({ code, patch: p }), onReset: (code) => setReset({ codes: [code], multi: false }) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- update.mutate kararlı; yalnız meşgul satır değişince sütun yenilenir
    [busyCode],
  );
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getRowId: (r) => r.code, enableRowSelection: false });
  const openRow = openCode ? (rows.find((r) => r.code === openCode) ?? null) : null;

  return (
    <PageShell>
      <PageHeader
        title={DOCUMENT_TYPES_TITLE}
        description="Tanıtılan belge tipleri. Tipe bağlanan gönderen cari, o tipte okunan taslakta gönderen önerisi olur. Satıra tıklayınca ayrıntı açılır; Düzenle fotoğrafsızdır; Sıfırla tipi unutturur, geri alınabilir."
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
      <Toolbar showUnused={showUnused} setShowUnused={setShowUnused} unusedCount={unused.length} noUserHint={!list.isLoading && !list.isError && userRows.length === 0} />
      <DataTable<SenderTemplateView>
        table={table}
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        errorText="Belge tipleri yüklenemedi — istek reddedildi ya da sunucuya ulaşamadı."
        emptyText={showUnused ? "Belge tipi yok." : "Kullanılan belge tipi yok."}
        exportName={DOCUMENT_TYPES_TITLE}
        onRowClick={(r) => setOpenCode(r.code)}
        rowContextMenu={(r) => (
          <>
            <ContextMenuItem onSelect={() => setOpenCode(r.code)}>
              <PanelRight /> Ayrıntıyı aç
            </ContextMenuItem>
            {/* row-menu-items'taki CopyMenuItem sekme deposunu (rota ağacı) çeker; burada yalnız pano gerekir. */}
            <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(r.code).then(() => toast.success("Tip kodu kopyalandı"))}>
              <Copy /> Tip kodunu kopyala
            </ContextMenuItem>
          </>
        )}
      />
      <BelgeTipiSheet
        row={openRow}
        template={openRow ? (templates.get(openRow.code) ?? null) : null}
        busy={openRow !== null && busyCode === openRow.code}
        onPatch={(p) => openRow && patch(openRow.code, p)}
        onReset={() => openRow && setReset({ codes: [openRow.code], multi: false })}
        onClose={() => setOpenCode(null)}
      />
      {reset && <SablonSifirlaDialog codes={reset.codes} multi={reset.multi} onOpenChange={(o) => !o && setReset(null)} />}
    </PageShell>
  );
}
