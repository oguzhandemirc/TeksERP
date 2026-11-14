// "Telefon bildirimleri" → Ses (S0): bildirim ve alarm sesi ayrı seçilir, her ses önizlenir (yerel bildirimle çalar),
// "Telefon ayarlarında değiştir" seçili kanalın Android ayarını açar (orada her sistem sesi seçilebilir). Seçim cihazda
// saklanır ve cihaz kaydıyla fabrikaya gider (`erpPushSesDegistir`); bulut Expo iletisinde kanal + sesi bundan kurar.
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SES_ADI, SESLER, VARSAYILAN_SES, sesSecimiYukle, type Ses, type SesSecimi, type SesSinifi } from "../../push/sesler";
import type { KeyValue } from "../../state/browser-store";
import { CheckRow, GroupNote } from "../diger/parts";
import { Button } from "../kit";
import { ListGroup } from "../ListRow";
import { SegmentedControl } from "../SegmentedControl";
import { SectionHeader } from "../SectionHeader";
import { useTokens } from "../theme-context";
import { space } from "../tokens";

const SINIFLAR = [{ key: "BILDIRIM", label: "Bildirim sesi" }, { key: "ALARM", label: "Alarm sesi" }] as const;

export function TelefonSesi({ store, disabled, onDegistir, onOnizle, onAyar }: {
  readonly store: () => KeyValue;
  readonly disabled: boolean;
  /** Yeni seçim (kaydet + kanal + kayıt yenileme çağıranda). */
  readonly onDegistir: (s: SesSecimi) => Promise<void>;
  readonly onOnizle: (sinif: SesSinifi, ses: Ses) => void;
  readonly onAyar: (sinif: SesSinifi, ses: Ses) => void;
}) {
  const t = useTokens();
  const [secim, setSecim] = useState<SesSecimi | null>(null);
  const [sinif, setSinif] = useState<SesSinifi>("BILDIRIM");
  useEffect(() => {
    let alive = true;
    void sesSecimiYukle(store()).then((s) => alive && setSecim(s), () => alive && setSecim(VARSAYILAN_SES));
    return () => {
      alive = false;
    };
  }, [store]);
  if (!secim) return null;
  const secili = sinif === "ALARM" ? secim.alarm : secim.bildirim;
  const sec = (ses: Ses) => {
    if (ses === secili) return;
    const yeni = sinif === "ALARM" ? { ...secim, alarm: ses } : { ...secim, bildirim: ses };
    setSecim(yeni);
    void onDegistir(yeni);
  };
  return (
    <View style={{ marginTop: space.m }} testID="telefon-ses">
      <SectionHeader title="Ses" />
      <SegmentedControl items={SINIFLAR} value={sinif} onChange={setSinif} testIDPrefix="telefon-ses-sinif-" accessibilityLabel="Hangi sesi değiştireceksiniz" />
      <GroupNote>{sinif === "ALARM" ? "Alarmlar (tezgah alarmı gibi) en yüksek öncelikle ve bu sesle gelir." : "Diğer bildirimler bu sesle gelir."}</GroupNote>
      <ListGroup testID={`telefon-ses-liste-${sinif}`}>
        {SESLER.map((ses) => (
          <CheckRow key={ses} kind="radio" title={SES_ADI[ses]} checked={ses === secili} disabled={disabled} onPress={() => sec(ses)} testID={`telefon-ses-${sinif}-${ses}`}
            right={
              <Pressable accessibilityRole="button" accessibilityLabel={`${SES_ADI[ses]} önizle`} hitSlop={8} disabled={disabled}
                onPress={() => onOnizle(sinif, ses)} testID={`telefon-ses-onizle-${sinif}-${ses}`}>
                <Ionicons name="play-circle-outline" size={28} color={disabled ? t.textMuted : t.tint} />
              </Pressable>
            } />
        ))}
      </ListGroup>
      <Button label="Telefon ayarlarında değiştir" tone="plain" icon="settings-outline" disabled={disabled} onPress={() => onAyar(sinif, secili)} testID="telefon-ses-ayar" />
    </View>
  );
}
