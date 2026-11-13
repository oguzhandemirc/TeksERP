// Koşum sonucunu PDF / Excel olarak paylaşma (ERP kipi): düğmeler yalnız yetenek açık ∧ koşum HAZIR ∧ sunucu o biçimi
// `dosyaBicimleri`nde bildirmişse görünür (eski fabrika/eski koşum → gizli). Telefonda paylaşım sayfası; web'de yalnız
// Excel tarayıcı indirmesiyle (PDF çevirisi cihazda yapılır, web'de yok). Çevrimdışıyken kapalı.
import { useState } from "react";
import { Platform, View } from "react-native";
import type { RaporKosumuDetay } from "../../../api/rapor";
import { yetenek } from "../../../api/yetenek";
import { saveDownloadedFile, type BrowserLike } from "../../../lib/export-file";
import { dosyaHataIletisi, raporDosyasiPaylas, type DosyaPortlari, type RaporDosyaTuru } from "../../../lib/rapor-dosya";
import { yerelDosyaPortlari } from "../../../lib/rapor-dosya-yerel";
import { reportTitle } from "../../../lib/labels/finans";
import { useSession } from "../../../state/session";
import { Banner, Button, Row } from "../../kit";
import { space } from "../../tokens";

const BICIM_ADI: Readonly<Record<RaporDosyaTuru, string>> = { pdf: "html", excel: "xlsx" };

/** Hangi düğmeler görünür (saf; ekran ve test aynı kuralı kullanır). */
export function disaAktarTurleri(kosum: RaporKosumuDetay, web: boolean): RaporDosyaTuru[] {
  if (!yetenek().raporDisaAktar || kosum.durum !== "HAZIR") return [];
  const bicimler = kosum.dosyaBicimleri ?? [];
  return (["pdf", "excel"] as const).filter((t) => bicimler.includes(BICIM_ADI[t]) && !(web && t === "pdf"));
}

export function DisaAktar({ kosum, portlar = yerelDosyaPortlari }: { readonly kosum: RaporKosumuDetay; readonly portlar?: DosyaPortlari }) {
  const { raporcu, offline } = useSession();
  const [busy, setBusy] = useState<RaporDosyaTuru | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = Platform.OS === "web";
  const turler = disaAktarTurleri(kosum, web);
  if (turler.length === 0) return null;

  async function aktar(tur: RaporDosyaTuru) {
    setBusy(tur);
    setError(null);
    try {
      if (web) {
        const file = await raporcu.dosya(kosum.id, "xlsx");
        if (!saveDownloadedFile(file, "web", globalThis as unknown as BrowserLike)) setError("Bu tarayıcı dosya indirmeyi desteklemiyor.");
      } else {
        await raporDosyasiPaylas(raporcu, kosum.id, tur, portlar, kosum.baslik ?? reportTitle(kosum.raporAnahtari));
      }
    } catch (err) {
      setError(dosyaHataIletisi(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ marginTop: space.l }} testID="disa-aktar">
      <Row>
        {turler.map((t) => (
          <Button
            key={t}
            label={t === "pdf" ? "PDF" : "Excel"}
            icon={t === "pdf" ? "document-text-outline" : "grid-outline"}
            tone="secondary"
            busy={busy === t}
            disabled={offline || (busy !== null && busy !== t)}
            onPress={() => void aktar(t)}
            accessibilityLabel={t === "pdf" ? "PDF olarak paylaş" : "Excel olarak paylaş"}
            testID={`disa-aktar-${t}`}
          />
        ))}
      </Row>
      {offline ? <Banner tone="off" text="Dosya indirmek için bağlantı gerekir." testID="disa-aktar-cevrimdisi" /> : null}
      {error ? <Banner tone="error" text={error} testID="disa-aktar-hata" /> : null}
    </View>
  );
}
