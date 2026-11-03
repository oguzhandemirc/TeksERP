// Başlık yanındaki ⓘ — ekran açıklaması başlık altında satır kaplamaz (K24);
// dokununca (ya da basılı tutunca) TruncatedText'in balonunda okunur.
import React, { useState } from 'react';
import { Pressable, StyleSheet, type GestureResponderEvent } from 'react-native';
import { Icon } from 'react-native-paper';
import TruncatedText, { NameBalloon } from './TruncatedText';
import type { BalloonPoint } from './truncatedTextLayout';
import { colors } from '../theme';

interface Props {
  text: string;
  testID?: string;
}

export default function HeaderInfoButton({ text, testID = 'ekran-aciklama' }: Props) {
  const [at, setAt] = useState<BalloonPoint | null>(null);
  const open = (e: GestureResponderEvent) => setAt({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
  return (
    <>
      <Pressable
        onPress={open}
        onLongPress={open}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={text}
        testID={testID}
        style={styles.hit}
      >
        <Icon source="information-outline" size={20} color={colors.textOnDarkMuted} />
      </Pressable>
      {at ? <NameBalloon text={text} at={at} onClose={() => setAt(null)} /> : null}
    </>
  );
}

/** Başlık altında GÖRÜNÜR kalan durum/bağlam satırı (açıklama değil veri). */
export function HeaderStatusLine({ text }: { text: string }) {
  return (
    <TruncatedText variant="labelMedium" style={styles.statusLine} revealOnTap testID="ekran-alt-baslik">
      {text}
    </TruncatedText>
  );
}

const styles = StyleSheet.create({
  hit: { padding: 2, borderRadius: 12 },
  statusLine: { textAlign: 'left', color: colors.textOnDarkMuted },
});
