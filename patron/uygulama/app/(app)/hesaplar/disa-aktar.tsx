// Dışa aktarma (yalnız tesis yöneticisi; Ek-6/A §4.2): hizmet sürerken ve bittikten sonraki 90 gün tesisin bulut
// verisinin dökümü JSON ya da CSV. Küme listesi ve izin kararı sunucuda (hesabın okuyabildiği projeksiyonlar + bulutta
// doğan veri); dosya yalnız web sürümünde kaydedilir (telefon uygulamasına dosya paketi eklenmedi).
import { useState } from "react";
import { Platform } from "react-native";
import { errorMessage } from "../../../src/api/client";
import type { ExportDataset, ExportFormat } from "../../../src/api/wire";
import { canSaveFiles, saveDownloadedFile, type BrowserLike } from "../../../src/lib/export-file";
import { formatDateTime, formatNumber } from "../../../src/lib/format";
import { humanize } from "../../../src/lib/present";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { ErrorBox } from "../../../src/ui/data";
import { Screen } from "../../../src/ui/Frame";
import { Banner, Body, Button, Card, Loading, Muted, Row } from "../../../src/ui/kit";

const CLOUD_LABELS: Readonly<Record<string, string>> = {
  "gelen-kutusu": "Gelen kutusu (sipariş/cari talepleri)",
  hesaplar: "Bulut hesapları",
  "hesap-denetimi": "Hesap güvenlik kaydı",
  "destek-erisimi": "Destek erişim kaydı",
};

const browser: BrowserLike | undefined = typeof window === "undefined" ? undefined : (window as unknown as BrowserLike);

function label(d: ExportDataset): string {
  return CLOUD_LABELS[d.ad] ?? humanize(d.ad);
}

export default function ExportScreen() {
  const { api, offline } = useSession();
  const r = useRemote("disa-aktar", () => api.exportManifest());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = canSaveFiles(Platform.OS, browser);

  async function download(kume: string, bicim: ExportFormat): Promise<void> {
    setBusy(`${kume}:${bicim}`);
    setError(null);
    try {
      saveDownloadedFile(await api.exportDownload(kume, bicim), Platform.OS, browser);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const hizmet = r.data?.hizmet;
  return (
    <Screen title="Dışa aktar" module="hesaplar">
      {hizmet?.asama === "SALT_OKUNUR" && hizmet.saltOkunurBitis ? (
        <Banner tone="warn" testID="disa-aktar-sure" text={`Hizmet sona erdi; dökümü ${formatDateTime(hizmet.saltOkunurBitis)} tarihine kadar alabilirsiniz. Sonra veriler imha edilir.`} />
      ) : null}
      {!web ? <Banner tone="off" testID="disa-aktar-web" text="Dosya yalnız web sürümünden indirilir: aynı hesapla tarayıcıdan patron bulutuna girip Hesaplar › Dışa aktar'ı açın." /> : null}
      {error ? <Banner tone="error" text={error} /> : null}
      {r.loading && !r.data ? <Loading /> : null}
      {r.error && !r.data ? <ErrorBox text={r.error} onRetry={r.reload} /> : null}
      {r.data?.kumeler.map((d) => (
        <Card key={d.ad} testID={`kume-${d.ad}`}>
          <Body>{label(d)}</Body>
          <Muted>{`${formatNumber(d.adet, 0)} kayıt`}</Muted>
          <Row>
            {d.bicimler.map((b) => (
              <Button key={b} label={b.toUpperCase()} tone="plain" disabled={!web || offline || busy !== null} busy={busy === `${d.ad}:${b}`} onPress={() => void download(d.ad, b)} testID={`indir-${d.ad}-${b}`} />
            ))}
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
