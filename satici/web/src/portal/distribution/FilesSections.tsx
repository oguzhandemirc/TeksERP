// Dosyalar sayfasının bölümleri ve pencereleri (FilesPage yalnız veri + durum taşır).
import type { Dispatch, SetStateAction } from "react";
import { fmtBytes, fmtDateTime } from "../../shared/format";
import { label } from "../../shared/labels";
import { Badge, Button, ErrorText, QueryState, Section, Table } from "../../shared/ui";
import { linkState } from "./FirstInstallPanel";
import { CancelLinkDialog, CancelRequestDialog, CreateLinkModal, CreateRequestModal, TokenSecretModal } from "./LinkDialogs";
import { LEDGER_EVENT_LABEL, type DownloadLink, type LedgerRow, type SharedFile, type TokenIssued, type UploadRequest } from "./types";
import { fileBodyUrl } from "./upload";

export type FilesDialog =
  | { kind: "share"; file: SharedFile }
  | { kind: "request" }
  | { kind: "issued"; issued: TokenIssued; title: string }
  | { kind: "cancelLink"; link: DownloadLink }
  | { kind: "cancelRequest"; request: UploadRequest }
  | null;

function retention(f: SharedFile) {
  return f.govdeBudandiAt ? <Badge tone="neutral">Gövde budandı</Badge> : <span>{fmtDateTime(f.saklamaBitis)}</span>;
}

function downloadCell(f: SharedFile) {
  return f.govdeBudandiAt ? null : (
    <a href={fileBodyUrl(f.id)} download={f.ad}>
      İndir
    </a>
  );
}

function requestState(r: UploadRequest, nowMs = Date.now()) {
  if (r.durum === "IPTAL") return <Badge tone="danger">İptal</Badge>;
  if (Date.parse(r.bitis) <= nowMs) return <Badge tone="neutral">Süresi doldu</Badge>;
  return <Badge tone="ok">Aktif</Badge>;
}

export interface FilesSectionsProps {
  readonly incoming: readonly SharedFile[];
  readonly outgoing: readonly SharedFile[];
  readonly links: readonly DownloadLink[];
  readonly requests: readonly UploadRequest[];
  readonly ledger: readonly LedgerRow[];
  readonly loading: boolean;
  readonly error: unknown;
  readonly canWrite: boolean;
  readonly fileName: (id: string | null) => string;
  readonly upload: { readonly busy: boolean; readonly progress: string; readonly error: unknown; readonly onFile: (f: File) => void };
  readonly open: Dispatch<SetStateAction<FilesDialog>>;
}

export function FilesSections(p: FilesSectionsProps) {
  const fileColumns = [
    { header: "Dosya", render: (f: SharedFile) => f.ad },
    { header: "Boyut", render: (f: SharedFile) => fmtBytes(f.boyut) },
    { header: "Yüklendi", render: (f: SharedFile) => fmtDateTime(f.createdAt) },
    { header: "Saklama", render: retention },
    { header: "", render: downloadCell },
  ];
  return (
    <>
      <QueryState isLoading={p.loading} error={p.error} />
      <Section title="Müşteriden gelen" actions={p.canWrite ? <Button onClick={() => p.open({ kind: "request" })}>Yükleme isteği ver</Button> : null}>
        <Table rows={p.incoming} rowKey={(f) => f.id} empty="Gelen dosya yok" columns={[...fileColumns, { header: "Gönderen", render: (f: SharedFile) => f.yukleyen }]} />
      </Section>
      <Section title="Müşteriye giden">
        {p.canWrite ? (
          <p>
            <input type="file" aria-label="Gönderilecek dosya" disabled={p.upload.busy} onChange={(e) => e.target.files?.[0] && p.upload.onFile(e.target.files[0])} />{" "}
            <span data-testid="yukleme-durumu">{p.upload.progress}</span>
          </p>
        ) : null}
        <ErrorText error={p.upload.error} />
        <Table
          rows={p.outgoing}
          rowKey={(f) => f.id}
          empty="Giden dosya yok"
          columns={[
            ...fileColumns,
            {
              header: "",
              render: (f: SharedFile) =>
                p.canWrite && !f.govdeBudandiAt ? (
                  <Button variant="ghost" onClick={() => p.open({ kind: "share", file: f })}>
                    Paylaş
                  </Button>
                ) : null,
            },
          ]}
        />
      </Section>
      <Section title="Paylaşım bağlantıları">
        <Table
          rows={p.links}
          rowKey={(l) => l.id}
          empty="Paylaşım bağlantısı yok"
          columns={[
            { header: "Dosya", render: (l) => p.fileName(l.dosyaId) },
            { header: "Belirteç", render: (l) => `…${l.belirtecSonu}` },
            { header: "İndirme", render: (l) => `${l.indirmeSayisi}/${l.azamiIndirme}` },
            { header: "Son gün", render: (l) => fmtDateTime(l.bitis) },
            { header: "Durum", render: (l) => <Badge tone={linkState(l).tone}>{linkState(l).text}</Badge> },
            { header: "", render: (l) => (p.canWrite && l.durum === "AKTIF" ? <Button variant="ghost" onClick={() => p.open({ kind: "cancelLink", link: l })}>İptal</Button> : null) },
          ]}
        />
      </Section>
      <Section title="Yükleme istekleri">
        <Table
          rows={p.requests}
          rowKey={(r) => r.id}
          empty="Yükleme isteği yok"
          columns={[
            { header: "Belirteç", render: (r) => `…${r.belirtecSonu}` },
            { header: "Kota", render: (r) => `${fmtBytes(r.kullanilanBayt)} / ${fmtBytes(r.kotaBayt)}` },
            { header: "Dosya tavanı", render: (r) => fmtBytes(r.azamiDosyaBayt) },
            { header: "Son gün", render: (r) => fmtDateTime(r.bitis) },
            { header: "Durum", render: (r) => requestState(r) },
            { header: "", render: (r) => (p.canWrite && r.durum === "AKTIF" ? <Button variant="ghost" onClick={() => p.open({ kind: "cancelRequest", request: r })}>İptal</Button> : null) },
          ]}
        />
      </Section>
      <Section title="Dağıtım defteri (son 50)">
        <Table
          rows={p.ledger}
          rowKey={(r) => r.id}
          empty="Kayıt yok"
          columns={[
            { header: "Zaman", render: (r) => fmtDateTime(r.createdAt) },
            { header: "Olay", render: (r) => label(LEDGER_EVENT_LABEL, r.olay) },
            { header: "Yapan", render: (r) => r.yapan },
          ]}
        />
      </Section>
    </>
  );
}

export function FilesDialogs({ customerId, dialog, setDialog, refresh }: { customerId: string; dialog: FilesDialog; setDialog: (d: FilesDialog) => void; refresh: () => void }) {
  const done = () => {
    setDialog(null);
    refresh();
  };
  if (!dialog) return null;
  if (dialog.kind === "share")
    return (
      <CreateLinkModal
        kind="DOSYA"
        customerId={customerId}
        fileId={dialog.file.id}
        fileName={dialog.file.ad}
        onClose={() => setDialog(null)}
        onIssued={(issued) => {
          setDialog({ kind: "issued", issued, title: "Paylaşım bağlantısı" });
          refresh();
        }}
      />
    );
  if (dialog.kind === "request")
    return (
      <CreateRequestModal
        customerId={customerId}
        onClose={() => setDialog(null)}
        onIssued={(issued) => {
          setDialog({ kind: "issued", issued, title: "Yükleme bağlantısı" });
          refresh();
        }}
      />
    );
  if (dialog.kind === "issued") return <TokenSecretModal issued={dialog.issued} title={dialog.title} what="Bu adres yalnız ŞİMDİ gösteriliyor." onClose={() => setDialog(null)} />;
  if (dialog.kind === "cancelLink") return <CancelLinkDialog link={dialog.link} onClose={() => setDialog(null)} onDone={done} />;
  return <CancelRequestDialog request={dialog.request} onClose={() => setDialog(null)} onDone={done} />;
}
