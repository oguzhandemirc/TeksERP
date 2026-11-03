// Açık kart listesinin arama kutusu (K17) — fiş / evrak / parti / İE no; süzme sunucuda.
import React from 'react';
import { TERIM } from '../../lib/terim';
import { StyleSheet } from 'react-native';
import { TextInput } from 'react-native-paper';
import ModalTextInput from '../ModalTextInput';

export default function OpenCardSearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <ModalTextInput
      mode="outlined"
      dense
      value={value}
      onChangeText={onChange}
      placeholder={`Fiş / evrak / parti / ${TERIM.terbiyeIsEmri.tekilKucuk} no ara`}
      autoCapitalize="characters"
      autoCorrect={false}
      left={<TextInput.Icon icon="magnify" />}
      style={styles.input}
      testID="acik-kart-ara"
      accessibilityLabel="Açık kartlarda ara"
    />
  );
}

const styles = StyleSheet.create({ input: { marginHorizontal: 10, marginTop: 8 } });
