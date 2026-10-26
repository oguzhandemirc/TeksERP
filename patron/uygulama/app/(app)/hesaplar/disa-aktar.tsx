// Dışa aktarma (yalnız tesis yöneticisi; Ek-6/A §4.2): hizmet sürerken ve bittikten sonraki 90 gün tesisin bulut
// verisinin dökümü JSON ya da CSV. Küme listesi ve izin kararı sunucuda (hesabın okuyabildiği projeksiyonlar + bulutta
// doğan veri); dosya yalnız web sürümünde kaydedilir (telefon uygulamasına dosya paketi eklenmedi).
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { errorMessage } from "../../../src/api/client";
import type { ExportDataset, ExportFormat } from "../../../src/api/wire";
import { canSaveFiles, saveDownloadedFile, type BrowserLike } from "../../../src/lib/export-file";
import { formatDateTime, formatNumber } from "../../../src/lib/format";
import { EXPORT_DATASET_LABEL } from "../../../src/lib/labels/diger";
import { humanize } from "../../../src/lib/present";
import { useSession } from "../../../src/state/session";
import { useRemote } from "../../../src/state/useRemote";
import { GroupNote } from "../../../src/ui/diger/parts";
import { Screen } from "../../../src/ui/Frame";
import { IconChip } from "../../../src/ui/IconChip";
import { Banner, Button } from "../../../src/ui/kit";
import { ListGroup } from "../../../src/ui/ListRow";
import { Empty, ErrorState, LoadingSkeleton } from "../../../src/ui/StateViews";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, tabularNums, typography } from "../../../src/ui/tokens";
import { EMPTY_ICON } from "../../../src/ui/icons";

const browser: BrowserLike | undefined = typeof window === "undefined" ? undefined : (window as unknown as BrowserLike);

function label(d: ExportDataset): string {
  return EXPORT_DATASET_LABEL[d.ad] ?? humanize(d.ad);
}

export default function ExportScreen() {
  const { api, offline } = useSession();
  const r = useRemote("disa-aktar", () => api.exportManifest());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = canSaveFiles(Platform.OS, browser);
  const s = useStyles();

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
    <Screen title="Dışa aktar" module="hesaplar" onRefresh={r.reload} refreshing={r.refreshing}>
      {hizmet?.asama === "SALT_OKUNUR" && hizmet.saltOkunurBitis ? (
        <Banner tone="warn" testID="disa-aktar-sure" text={`Hizmet sona erdi; dökümü ${formatDateTime(hizmet.saltOkunurBitis)} tarihine kadar alabilirsiniz. Sonra veriler imha edilir.`} />
      ) : null}
      {!web ? <Banner tone="off" testID="disa-aktar-web" text="Dosya yalnız web sürümünden indirilir: aynı hesapla tarayıcıdan TeksERP Yönetim'e girip Hesaplar › Dışa aktar'ı açın." /> : null}
      <GroupNote>Tesisin bulut verisinin dökümü; her küme ayrı dosya. Liste hesabınızın okuyabildiği verilerle sınırlıdır.</GroupNote>
      {error ? <Banner tone="error" text={error} /> : null}
      {r.loading && !r.data ? <LoadingSkeleton rows={4} /> : null}
      {r.error && !r.data ? <ErrorState text={r.error} onRetry={r.reload} /> : null}
      {r.data && r.data.kumeler.length === 0 ? <Empty icon={EMPTY_ICON.arsiv} text="Dışa aktarılacak veri yok" /> : null}
      {r.data && r.data.kumeler.length > 0 ? (
        <ListGroup testID="kume-listesi">
          {r.data.kumeler.map((d) => (
            <View key={d.ad} testID={`kume-${d.ad}`} style={s.row}>
              <View style={s.head}>
                <IconChip domain="raporlar" icon="document-outline" size={36} />
                <View style={s.text}>
                  <Text style={s.title}>{label(d)}</Text>
                  <Text style={s.count}>{`${formatNumber(d.adet, 0)} kayıt`}</Text>
                </View>
              </View>
              <View style={s.formats}>
                {d.bicimler.map((b) => (
                  <View key={b} style={s.format}>
                    <Button label={b.toUpperCase()} tone="secondary" disabled={!web || offline || busy !== null} busy={busy === `${d.ad}:${b}`} onPress={() => void download(d.ad, b)} testID={`indir-${d.ad}-${b}`} />
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ListGroup>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  // Biçim düğmeleri her satırda başlığın altında, metinle aynı hizada (tek biçimli satır sağa kaçmasın).
  row: { gap: space.s, paddingHorizontal: space.l, paddingVertical: space.m },
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m },
  text: { flex: 1, minWidth: 0 },
  title: { ...typography.headline, color: t.text },
  count: { ...typography.footnote, ...tabularNums, color: t.textSecondary, marginTop: 1 },
  formats: { flexDirection: "row" as const, gap: space.s, paddingLeft: 36 + space.m },
  format: { minWidth: 76 },
}));
