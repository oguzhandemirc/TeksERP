// Saklı koşumun sonucu: üstte "Oluşturuldu: … · parametre özeti", altında fabrikanın sunumu (`SunumGorunumu`) ya da
// jenerik döküm; HATA'lı koşumda kısa Türkçe neden; altta PDF/Excel paylaşımı (`DisaAktar`, yalnız ERP kipi). Sonuç görüntüleyici bulut kipiyle ORTAK (yeniden kurulmaz).
import { Text, View } from "react-native";
import type { RaporKosumuDetay } from "../../../api/rapor";
import { reportDomain } from "../../../lib/labels/finans";
import { kosumHataIletisi, kosumTarihi, ozetMetni } from "../../../lib/rapor-anlik";
import { isPresentation } from "../../../lib/reports";
import { SnapshotView } from "../../data";
import { Banner, Card } from "../../kit";
import { makeStyles } from "../../theme-context";
import { space, typography } from "../../tokens";
import { SunumGorunumu } from "../SunumGorunumu";
import { DisaAktar } from "./DisaAktar";

export function KosumSonucu({ kosum, testID = "kosum-sonucu" }: { readonly kosum: RaporKosumuDetay; readonly testID?: string }) {
  const s = useStyles();
  const dom = reportDomain(kosum.raporAnahtari);
  const veri = kosum.sonuc?.veri;
  return (
    <View testID={testID}>
      <Text style={s.meta} testID="kosum-ust">{`Oluşturuldu: ${kosumTarihi(kosum)} · ${ozetMetni(kosum)}`}</Text>
      {kosum.durum === "HATA" ? <Banner tone="error" text={kosumHataIletisi(kosum.hataKodu)} testID="kosum-hata" /> : null}
      {kosum.sonuc && isPresentation(veri) ? <SunumGorunumu sunum={veri} domain={dom.domain} /> : null}
      {kosum.sonuc && !isPresentation(veri) ? (
        <Card domain={dom.domain} testID="kosum-dokum">
          <SnapshotView value={veri} />
        </Card>
      ) : null}
      <DisaAktar kosum={kosum} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  meta: { ...typography.footnote, color: t.textSecondary, marginBottom: space.s },
}));
