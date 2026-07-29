import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import AppModal from './AppModal';
import {
  Text,
  TextInput,
  Button,
  IconButton,
  Icon,
  Checkbox,
  TouchableRipple,
} from 'react-native-paper';

// =============================================================================
// ConfirmDialog — onay/uyarı modal'ları için tek yer.
//
// API discriminated union ile illegal state'i engeller:
//   - kind: 'simple'      → sadece title + description + onayla
//   - kind: 'destructive' → kırmızı buton + opsiyonel sebep + opsiyonel
//                            etkilenen kayıt listesi (CLAUDE.md spec)
//
// `destructive` modunda `affected` geçilmediği sürece "X kayıt etkilenecek"
// gibi soyut bir mesaj göstermeyiz — gerekli ise parent description'a
// yazsın. `affected` geçilirse her satır checkbox ile listelenir; operatör
// hangi kayıtların etkileneceğini SOMUT görür ve seçer.
// =============================================================================

export interface AffectedItem {
  id: string;
  label: string;
  sublabel?: string;
  /** Başlangıçta seçili gelsin mi (default: true). */
  defaultChecked?: boolean;
  /** Toggle edilemez (örn. backend "safe to cancel: false" → kabul edilemez). */
  blocked?: boolean;
  /** Bloklandıysa kullanıcıya gösterilecek sebep. */
  blockReason?: string;
}

export interface ReasonConfig {
  label?: string;
  placeholder?: string;
  /** Zorunlu mu (default: true). */
  required?: boolean;
  /** Min karakter (default: 3). */
  minLength?: number;
  /** Çok satırlı text alanı (default: true — sebep genelde 1-2 cümle). */
  multiline?: boolean;
}

interface CommonProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  /** Plain text veya custom JSX. */
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Submit sürerken loading + butonları kilitle. */
  confirming?: boolean;
}

type SimpleProps = CommonProps & {
  kind: 'simple';
  onConfirm: () => void;
};

type DestructiveProps = CommonProps & {
  kind: 'destructive';
  /** Sebep girişi gerekiyorsa config; geçilmezse sebep alanı render edilmez. */
  reason?: ReasonConfig;
  /** Etkilenen kayıtlar — geçilirse checkbox list olarak gösterilir.
   *  CLAUDE.md kuralı: yıkıcı işlemde somut listele, "X kayıt" deme. */
  affected?: AffectedItem[];
  onConfirm: (payload: { reason?: string; selectedIds?: string[] }) => void;
};

type Props = SimpleProps | DestructiveProps;

export default function ConfirmDialog(props: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const isDestructive = props.kind === 'destructive';

  // Sebep state — destructive + reason geçilince aktif olur.
  const [reason, setReason] = useState('');
  // Affected checkbox state.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal her açılışında temizle — önceki state taşmasın.
  useEffect(() => {
    if (props.visible) {
      setReason('');
      if (isDestructive && (props as DestructiveProps).affected) {
        const init = new Set<string>();
        for (const item of (props as DestructiveProps).affected!) {
          if (item.blocked) continue;
          if (item.defaultChecked !== false) init.add(item.id);
        }
        setSelectedIds(init);
      } else {
        setSelectedIds(new Set());
      }
    }
  }, [props.visible]);

  const reasonCfg = isDestructive
    ? (props as DestructiveProps).reason
    : undefined;
  const reasonRequired = reasonCfg?.required ?? true;
  const reasonMin = reasonCfg?.minLength ?? 3;
  const affected = isDestructive
    ? (props as DestructiveProps).affected
    : undefined;

  const canSubmit = (() => {
    if (props.confirming) return false;
    if (reasonCfg && reasonRequired && reason.trim().length < reasonMin) {
      return false;
    }
    if (affected && affected.length > 0 && selectedIds.size === 0) {
      return false;
    }
    return true;
  })();

  const handleConfirm = () => {
    if (!canSubmit) return;
    if (props.kind === 'simple') {
      props.onConfirm();
    } else {
      props.onConfirm({
        reason: reasonCfg ? reason.trim() : undefined,
        selectedIds: affected ? Array.from(selectedIds) : undefined,
      });
    }
  };

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <AppModal
      visible={props.visible}
      onDismiss={props.onDismiss}
      dismissable={!props.confirming}
    >
      {/* Klavye lifti AppModal'dan gelir (merkez modal yukarı kayar) — içteki
          RN KeyboardAvoidingView (Android'de zaten no-op'tu) kaldırıldı. */}
      <View
        style={[
          styles.sheet,
          { maxWidth: Math.min(winW * 0.9, 480), maxHeight: winH * 0.85 },
        ]}
      >
        <View style={styles.header}>
          <Icon
            source={isDestructive ? 'alert-circle' : 'help-circle'}
            size={22}
            color={isDestructive ? '#dc2626' : '#0f172a'}
          />
          <Text variant="titleMedium" style={styles.title}>
            {props.title}
          </Text>
        </View>

        {/* Body ScrollView içinde — uzun affected listesi veya uzun açıklama
            butonları ekran dışına itmesin. Sheet'te overflow:'hidden' + sınırlı
            maxHeight olduğu için body'nin shrink+scroll olması şart. */}
        <KeyboardAwareScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          bottomOffset={72}
        >
          {typeof props.description === 'string' ? (
            <Text style={styles.descText}>{props.description}</Text>
          ) : (
            props.description
          )}

          {affected && affected.length > 0 && (
            <View style={styles.affectedBox}>
              <Text style={styles.affectedTitle}>
                Etkilenecek {affected.length} kayıt:
              </Text>
              {affected.map((item) => (
                <AffectedRow
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  onToggle={() => toggleId(item.id)}
                />
              ))}
            </View>
          )}

          {reasonCfg && (
            <TextInput
              mode="outlined"
              label={reasonCfg.label ?? 'Sebep'}
              placeholder={reasonCfg.placeholder ?? 'Kısaca açıkla...'}
              value={reason}
              onChangeText={setReason}
              multiline={reasonCfg.multiline ?? true}
              numberOfLines={reasonCfg.multiline === false ? 1 : 2}
              autoFocus
              style={styles.reasonInput}
            />
          )}
        </KeyboardAwareScrollView>

        <View style={styles.actions}>
          <Button
            mode="text"
            onPress={props.onDismiss}
            disabled={props.confirming}
          >
            {props.cancelLabel ?? 'Vazgeç'}
          </Button>
          <Button
            mode="contained"
            buttonColor={isDestructive ? '#dc2626' : undefined}
            onPress={handleConfirm}
            disabled={!canSubmit}
            loading={props.confirming}
          >
            {props.confirmLabel ?? (isDestructive ? 'Onayla' : 'Tamam')}
          </Button>
        </View>
      </View>
    </AppModal>
  );
}

function AffectedRow({
  item,
  selected,
  onToggle,
}: {
  item: AffectedItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const checked = item.blocked ? false : selected;
  return (
    <TouchableRipple
      onPress={item.blocked ? undefined : onToggle}
      disabled={item.blocked}
      style={[styles.affectedRow, item.blocked && styles.affectedRowBlocked]}
    >
      <View style={styles.affectedRowInner}>
        <Checkbox
          status={checked ? 'checked' : 'unchecked'}
          disabled={item.blocked}
          onPress={item.blocked ? undefined : onToggle}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.affectedLabel} numberOfLines={2}>
            {item.label}
          </Text>
          {item.sublabel && (
            <Text style={styles.affectedSublabel} numberOfLines={1}>
              {item.sublabel}
            </Text>
          )}
          {item.blocked && item.blockReason && (
            <Text style={styles.affectedBlock} numberOfLines={2}>
              ⚠ {item.blockReason}
            </Text>
          )}
        </View>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 14,
    width: '90%',
    // AppModal center wrapper'ı dış kutuyu ortalar; iç sheet'in width:'90%' +
    // maxWidth'i olduğundan flex cross-axis'te varsayılan olarak SOLA yaslanır
    // (yatayda kayık görünür). alignSelf:'center' sheet'i dış kutu içinde ortalar.
    alignSelf: 'center',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontWeight: '700', color: '#0f172a', flex: 1 },
  // ScrollView wrapper — flexShrink:1 ile sheet maxHeight'i aşan içerikte
  // shrink edip internal scroll olur; header + actions sabit kalır.
  bodyScroll: { flexShrink: 1 },
  body: { paddingHorizontal: 16, gap: 12, paddingBottom: 8 },
  descText: { fontSize: 14, color: '#475569', lineHeight: 20 },

  affectedBox: { gap: 6 },
  affectedTitle: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4 },
  affectedRow: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  affectedRowBlocked: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  affectedRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 10,
    paddingVertical: 2,
  },
  affectedLabel: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  affectedSublabel: { fontSize: 11, color: '#64748b', marginTop: 1 },
  affectedBlock: { fontSize: 11, color: '#b91c1c', marginTop: 2 },

  reasonInput: { backgroundColor: '#fff' },

  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
});
