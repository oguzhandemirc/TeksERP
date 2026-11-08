// İş Emirleri — oluşturma: tek İE formu (UnifiedWoForm; "Belge Okut" = tarayıcı hemen açılır, "Elle Oluştur" = belgesiz).
// Okuma bitince doğrudan form (ara "Belge okundu" kartı 2026-11-08'de kalktı): çözülemeyen müşteri teklifi
// (`CustomerFromDocSheet`) formun üstünde kendiliğinden açılır, bulunamayan alanlar Belge şeridinde uyarılır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ProductionRoute } from '../../../services/route.service';
import UnifiedWoForm from '../GelenBelge/woCreate/UnifiedWoForm';
import type { WoCreateKind } from '../../../store/woCreateKinds';

interface StageProps {
  /** Formun ön seçili rotası (null = formda seçilir). */
  route: ProductionRoute | null;
  kinds: readonly WoCreateKind[];
  manual: boolean;
  /** Kaydedildikten sonra "Yeni iş emri". */
  onNew: () => void;
  /** ⚙ Alanlar sayfası başlık ikonundan (kontrollü); verilmezse form kendi düğmesini çizer. */
  fieldsOpen?: boolean;
  onFieldsOpenChange?: (open: boolean) => void;
}

export default function ScanStage({ route, kinds, manual, onNew, fieldsOpen, onFieldsOpenChange }: StageProps) {
  return (
    <View style={styles.fill}>
      <UnifiedWoForm
        initialRoute={route}
        routeLocked={false}
        onNew={onNew}
        fieldsOpen={fieldsOpen}
        onFieldsOpenChange={onFieldsOpenChange}
        ownerKinds={kinds}
        autoScan={!manual}
        manual={manual}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
