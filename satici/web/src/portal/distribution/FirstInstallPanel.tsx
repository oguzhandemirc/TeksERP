// KURULUM DETAYI → İLK KURULUM: bu kurulum için verilmiş indirme bağlantıları (derleme · geçerlilik ·
// indirme sayısı · durum) + yeni bağlantı + iptal. Bağlantı adresi yalnız verildiği anda bir kez görünür.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fmtBytes, fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { useCan } from "../../shared/session";
import type { Installation } from "../../shared/types";
import { Badge, Button, QueryState, Section, Table } from "../../shared/ui";
import { CancelLinkDialog, CreateLinkModal, TokenSecretModal } from "./LinkDialogs";
import type { DownloadLink, TokenIssued } from "./types";

export function linkState(l: DownloadLink, nowMs = Date.now()): { text: string; tone: "ok" | "warn" | "danger" | "neutral" } {
  if (l.durum === "IPTAL") return { text: "İptal", tone: "danger" };
  if (Date.parse(l.bitis) <= nowMs) return { text: "Süresi doldu", tone: "neutral" };
  if (l.indirmeSayisi >= l.azamiIndirme) return { text: "Hakkı bitti", tone: "neutral" };
  return { text: "Aktif", tone: "ok" };
}

type Dialog = { kind: "create" } | { kind: "cancel"; link: DownloadLink } | { kind: "issued"; issued: TokenIssued } | null;

export function FirstInstallPanel({ installation }: { installation: Installation }) {
  const canWrite = useCan("dagitim:yaz");
  const queryClient = useQueryClient();
  const links = useGet<DownloadLink[]>(["dagitim-baglantilari", installation.id], "/dagitim/baglantilar", { kurulumId: installation.id });
  const [dialog, setDialog] = useState<Dialog>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["dagitim-baglantilari"] });
  return (
    <Section
      title="İlk kurulum bağlantısı"
      actions={
        canWrite && installation.aktif ? (
          <Button variant="primary" onClick={() => setDialog({ kind: "create" })}>
            Bağlantı ver
          </Button>
        ) : null
      }
    >
      <p className="muted">Müşteriye özel, süreli ve indirme sayısı sınırlı bağlantı. Açılış sayfası hak tüketmez; her indirme bir hak tüketir.</p>
      <QueryState isLoading={links.isLoading} error={links.error} />
      <Table
        rows={links.data ?? []}
        rowKey={(r) => r.id}
        empty="Bu kuruluma bağlantı verilmemiş"
        columns={[
          { header: "Derleme", render: (r) => `${r.derlemeAdi ?? "—"} (${fmtBytes(r.derlemeBoyut)})` },
          { header: "Belirteç", render: (r) => `…${r.belirtecSonu}` },
          { header: "İndirme", render: (r) => `${r.indirmeSayisi}/${r.azamiIndirme}` },
          { header: "Son gün", render: (r) => fmtDateTime(r.bitis) },
          {
            header: "Durum",
            render: (r) => {
              const s = linkState(r);
              return <Badge tone={s.tone}>{s.text}</Badge>;
            },
          },
          { header: "Veren", render: (r) => r.olusturan },
          {
            header: "",
            render: (r) =>
              canWrite && r.durum === "AKTIF" ? (
                <Button variant="ghost" onClick={() => setDialog({ kind: "cancel", link: r })}>
                  İptal
                </Button>
              ) : null,
          },
        ]}
      />
      {dialog?.kind === "create" ? (
        <CreateLinkModal
          kind="ILK_KURULUM"
          customerId={installation.tesis.musteri.id}
          installationDbId={installation.id}
          onClose={() => setDialog(null)}
          onIssued={(issued) => {
            setDialog({ kind: "issued", issued });
            refresh();
          }}
        />
      ) : null}
      {dialog?.kind === "issued" ? (
        <TokenSecretModal issued={dialog.issued} title="İlk kurulum bağlantısı" what="Bu adres yalnız ŞİMDİ gösteriliyor." onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "cancel" ? (
        <CancelLinkDialog
          link={dialog.link}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
    </Section>
  );
}
