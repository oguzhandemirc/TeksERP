// =============================================================================
// IdleWarning — kilitten ÖNCE geri sayım + "Devam et" bandı
// =============================================================================
// Idle süresi dolmadan `IDLE_WARNING_MS` (20 sn) önce görünür. Operatör "Devam
// et"e basınca aktivite tazelenir (kilit iptal). Basmazsa geri sayım biter →
// LockScreen devreye girer.
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function IdleWarning({
  seconds,
  onContinue,
}: {
  seconds: number;
  onContinue: () => void;
}) {
  return (
    <View style={styles.root} pointerEvents="box-none">
      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <View style={styles.banner}>
          <Icon source="timer-sand" size={26} color="#fbbf24" />
          <View style={styles.textWrap}>
            <Text style={styles.title}>Hareketsizlik nedeniyle kilitlenecek</Text>
            <Text style={styles.sub}>{seconds} sn içinde ekran kilitlenir</Text>
          </View>
          <Button
            mode="contained"
            onPress={onContinue}
            style={styles.btn}
            contentStyle={styles.btnContent}
            buttonColor="#f59e0b"
            textColor="#1f2937"
          >
            Devam et
          </Button>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Üstte sabit — içerik dokunmayı yutmasın (box-none), yalnız banner tıklanır.
  root: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-start', zIndex: 9998, elevation: 9998 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    margin: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#f59e0b',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  textWrap: { flex: 1 },
  title: { color: '#f9fafb', fontSize: 15, fontWeight: '800' },
  sub: { color: '#fcd34d', fontSize: 13, marginTop: 2, fontWeight: '600' },
  btn: { borderRadius: 12 },
  btnContent: { minHeight: 48, paddingHorizontal: 8 },
});
