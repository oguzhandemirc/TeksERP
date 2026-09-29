// DOSYALAR — iki yönlü dosya paylaşımı (Faz 3d), müşteri başına: müşteriden GELEN dosyalar · bizden
// GİDEN dosyalar (parçalı yükleme, paylaşım bağlantısı) · yükleme istekleri (/y) · dağıtım defteri.
// Saklama süresi dolan dosyanın gövdesi budanır; satır ve defter kalır ("budandı" rozeti).
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { newClientToken } from "../../shared/attempt";
import { useGet } from "../../shared/hooks";
import { useApi, useCan } from "../../shared/session";
import type { Customer, Page } from "../../shared/types";
import { Field, PageTitle, QueryState, Section } from "../../shared/ui";
import { FilesDialogs, FilesSections, type FilesDialog } from "../distribution/FilesSections";
import type { DownloadLink, LedgerRow, SharedFile, UploadRequest } from "../distribution/types";
import { uploadOutgoing } from "../distribution/upload";

export function FilesPage() {
  const [params, setParams] = useSearchParams();
  const customerId = params.get("musteriId") ?? "";
  const customers = useGet<Page<Customer>>(["musteriler", "secim"], "/musteriler", { limit: 200, aktif: true });
  return (
    <>
      <PageTitle title="Dosyalar" sub="Müşteriyle iki yönlü dosya paylaşımı: süreli bağlantı, kota, saklama süresi, defter." />
      <Section title="Müşteri">
        <QueryState isLoading={customers.isLoading} error={customers.error} />
        <Field label="Müşteri">
          <select value={customerId} onChange={(e) => setParams(e.target.value ? { musteriId: e.target.value } : {})}>
            <option value="">Seçin…</option>
            {(customers.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.ad}
              </option>
            ))}
          </select>
        </Field>
      </Section>
      {customerId ? <CustomerFiles customerId={customerId} /> : null}
    </>
  );
}

function CustomerFiles({ customerId }: { customerId: string }) {
  const api = useApi();
  const canWrite = useCan("dagitim:yaz");
  const queryClient = useQueryClient();
  const q = { musteriId: customerId };
  const files = useGet<SharedFile[]>(["dagitim-dosyalari", customerId], "/dagitim/dosyalar", q);
  const links = useGet<DownloadLink[]>(["dagitim-baglantilari", customerId], "/dagitim/baglantilar", q);
  const requests = useGet<UploadRequest[]>(["dagitim-istekleri", customerId], "/dagitim/yukleme-istekleri", q);
  const ledger = useGet<LedgerRow[]>(["dagitim-defteri", customerId], "/dagitim/defter", { ...q, limit: 50 });
  const [dialog, setDialog] = useState<FilesDialog>(null);
  const [progress, setProgress] = useState("");
  const [uploadError, setUploadError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const tokens = useRef(new Map<string, string>());
  const refresh = () => {
    for (const k of ["dagitim-dosyalari", "dagitim-baglantilari", "dagitim-istekleri", "dagitim-defteri"]) void queryClient.invalidateQueries({ queryKey: [k] });
  };
  const upload = async (file: File) => {
    // Aynı dosya yeniden seçilirse AYNI işlem kimliği: sunucu aynı oturumu döndürür, alınan parçalar atlanır.
    const id = `${file.name}:${file.size}:${file.lastModified}`;
    const token = tokens.current.get(id) ?? newClientToken();
    tokens.current.set(id, token);
    setBusy(true);
    setUploadError(null);
    try {
      await uploadOutgoing({ api, customerId, file, clientToken: token, onProgress: setProgress });
      tokens.current.delete(id);
      setProgress(`Yüklendi: ${file.name}`);
      refresh();
    } catch (err) {
      setUploadError(err);
      setProgress("");
    } finally {
      setBusy(false);
    }
  };
  const all = files.data ?? [];
  const incoming = all.filter((f) => f.yon === "GELEN");
  const outgoing = all.filter((f) => f.yon === "GIDEN");
  const fileName = (id: string | null) => all.find((f) => f.id === id)?.ad ?? "—";
  return (
    <>
      <FilesSections
        incoming={incoming}
        outgoing={outgoing}
        links={(links.data ?? []).filter((l) => l.tur === "DOSYA")}
        requests={requests.data ?? []}
        ledger={ledger.data ?? []}
        loading={files.isLoading || links.isLoading || requests.isLoading}
        error={files.error ?? links.error ?? requests.error ?? ledger.error}
        canWrite={canWrite}
        fileName={fileName}
        upload={{ busy, progress, error: uploadError, onFile: (f) => void upload(f) }}
        open={setDialog}
      />
      <FilesDialogs customerId={customerId} dialog={dialog} setDialog={setDialog} refresh={refresh} />
    </>
  );
}
