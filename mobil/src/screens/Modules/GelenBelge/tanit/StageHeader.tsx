// ① Tanıma: her belgede aynı kalan yazılara dokunulur (satır kimlik rengiyle çerçevelenir), canlı tanıma oranı, benzeyen tip
// bağlantısı ve belge tipinin adı.
import React from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import ModalTextInput from '../../../../components/ModalTextInput';
import type { SuggestResult } from '../../../../types/inboundDocTeach';
import { Frame, parts } from './stageParts';
import { recognitionText } from './stages';
import type { TeachState } from './teachDraft';

interface Props {
  state: TeachState;
  onChange: (fn: (s: TeachState) => TeachState) => void;
  preview: { result: SuggestResult | null; fresh: boolean };
  /** Yeni tip tanıtılırken benzeyen mevcut tipi düzenlemeye geç (kaydetmez). */
  onAdoptSimilar?: (kod: string) => void;
}

export default function StageHeader({ state, onChange, preview, onAdoptSimilar }: Props) {
  const headers = state.identifiers.filter((d) => d.on).map((d) => d.text);
  const rec = preview.fresh ? recognitionText(preview.result) : null;
  const similar = preview.fresh ? preview.result?.benzerSablonlar?.[0] : undefined;
  return (
    <View style={parts.gap} testID="tanit-asama-1">
      <Text style={parts.ask} testID="tanit-soru">Bu tip belgede her zaman aynı olan yazılara dokunun</Text>
      <Text style={parts.info}>Firma adı, belge başlığı gibi. Müşteri adı ya da numara gibi değişen yazılar değil. Önerilenler seçili.</Text>
      <Frame testID="tanit-baslik-secili">
        <View style={[parts.row, parts.gap]}>
          {headers.length ? headers.map((t) => <Text key={t} style={parts.value}>{`“${t}”`}</Text>) : <Text style={parts.placeholder}>Henüz kimlik yazısı seçilmedi.</Text>}
        </View>
      </Frame>
      {rec ? (
        <Text style={rec.ok ? parts.ok : parts.warn} testID="tanit-taninma">{rec.text}</Text>
      ) : (
        <Text style={parts.info} testID="tanit-taninma">Tanıma oranı ilk alan eşlenince görünür.</Text>
      )}
      {similar && onAdoptSimilar ? (
        <View testID="tanit-benzeyen">
          <Text style={parts.info}>{`Benzeyen tip: ${similar.ad}`}</Text>
          <Button mode="text" icon="file-edit-outline" onPress={() => onAdoptSimilar(similar.kod)} contentStyle={parts.btn} testID="tanit-benzeyen-duzenle">
            Onu düzenle
          </Button>
        </View>
      ) : null}
      <ModalTextInput
        label="Belge tipinin adı"
        mode="outlined"
        value={state.name}
        maxLength={80}
        placeholder="ör. Güleçsoy çeki listesi"
        onChangeText={(name) => onChange((s) => ({ ...s, name }))}
        testID="tanit-rehber-ad"
      />
    </View>
  );
}
