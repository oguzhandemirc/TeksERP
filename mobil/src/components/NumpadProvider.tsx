import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { StyleSheet, StyleProp, View, ViewStyle, useWindowDimensions } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import AppModal from './AppModal';
import Numpad from './Numpad';

interface NumpadTarget {
  id: string;
  label?: string;
  allowDecimal: boolean;
  maxLength?: number;
  getValue: () => string;
  onChange: (next: string) => void;
}

interface ValueNotifier {
  subscribe: (l: () => void) => () => void;
  getSnapshot: () => number;
  notify: () => void;
}

function createValueNotifier(): ValueNotifier {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getSnapshot: () => version,
    notify: () => {
      version++;
      listeners.forEach((l) => l());
    },
  };
}

interface NumpadContextValue {
  target: NumpadTarget | null;
  openTarget: (target: NumpadTarget) => void;
  closeTarget: (id?: string) => void;
  notifyChange: (id: string) => void;
  notifier: ValueNotifier;
}

const NumpadContext = createContext<NumpadContextValue | null>(null);

export function useNumpadContext(): NumpadContextValue {
  const ctx = useContext(NumpadContext);
  if (!ctx) throw new Error('useNumpadContext must be used inside NumpadProvider');
  return ctx;
}

export function NumpadProvider({ children }: { children: React.ReactNode }) {
  const targetRef = useRef<NumpadTarget | null>(null);
  const [target, setTarget] = useState<NumpadTarget | null>(null);
  // Value change notifier — sadece NumpadHost'u re-render eder, Provider'ı
  // tetiklemez. Aksi halde her tuş basışı context value'sunu değiştirip
  // ağaçtaki tüm NumpadInput'ları (ve consume eden her şeyi) re-render eder.
  const notifierRef = useRef<ValueNotifier | null>(null);
  if (notifierRef.current === null) {
    notifierRef.current = createValueNotifier();
  }

  const openTarget = useCallback((t: NumpadTarget) => {
    targetRef.current = t;
    setTarget(t);
  }, []);

  const closeTarget = useCallback((id?: string) => {
    if (id !== undefined && targetRef.current?.id !== id) return;
    targetRef.current = null;
    setTarget(null);
  }, []);

  const notifyChange = useCallback((id: string) => {
    if (targetRef.current?.id === id) {
      notifierRef.current!.notify();
    }
  }, []);

  const value = useMemo<NumpadContextValue>(
    () => ({
      target,
      openTarget,
      closeTarget,
      notifyChange,
      notifier: notifierRef.current!,
    }),
    [target, openTarget, closeTarget, notifyChange]
  );

  return <NumpadContext.Provider value={value}>{children}</NumpadContext.Provider>;
}

interface NumpadHostProps {
  style?: StyleProp<ViewStyle>;
  /** true → host kalan alanı (flex) doldurur ve tuşlar buna yayılır (Numpad.fill).
   *  Dar/kısa kolonlarda numpad'in alttan taşmasını önler. Default: sabit yükseklik. */
  fill?: boolean;
}

export function NumpadHost({ style, fill = false }: NumpadHostProps) {
  const { target, notifier } = useNumpadContext();
  useSyncExternalStore(notifier.subscribe, notifier.getSnapshot);

  const value = target ? target.getValue() : '';
  const onChange = target?.onChange ?? noop;
  const allowDecimal = target?.allowDecimal ?? true;
  const maxLength = target?.maxLength;
  const disabled = !target;

  return (
    <Surface style={[styles.host, fill && styles.hostFill, style]} elevation={1}>
      <Numpad
        value={value}
        onChange={onChange}
        allowDecimal={allowDecimal}
        maxLength={maxLength}
        disabled={disabled}
        fill={fill}
      />
    </Surface>
  );
}

const noop = () => {};

/**
 * Bottom-sheet numpad — küçük ekranda (telefon landscape) sabit `NumpadHost`
 * yerine kullanılır. `target` set olunca açılır, dış tıklama/Tamam kapatır.
 * Modal-only davranır; ekrandan yer ayırmaz.
 */
export function NumpadModalHost() {
  const { target, closeTarget, notifier } = useNumpadContext();
  useSyncExternalStore(notifier.subscribe, notifier.getSnapshot);
  const { width: winW, height: winH } = useWindowDimensions();

  const value = target ? target.getValue() : '';
  const onChange = target?.onChange ?? noop;
  const allowDecimal = target?.allowDecimal ?? true;
  const maxLength = target?.maxLength;
  const compactKeys = winH < 500;

  return (
    <AppModal visible={!!target} onDismiss={() => closeTarget()} position="bottom">
      <Surface style={modalStyles.sheet} elevation={4}>
        <View style={modalStyles.header}>
          <View style={{ flex: 1 }}>
            {target?.label ? (
              <Text style={modalStyles.label}>{target.label}</Text>
            ) : null}
            <Text style={modalStyles.value} numberOfLines={1}>
              {value || '0'}
            </Text>
          </View>
          <Button mode="contained" icon="check" onPress={() => closeTarget()}>
            Tamam
          </Button>
        </View>
        <View style={modalStyles.numpadWrap}>
          <Numpad
            value={value}
            onChange={onChange}
            allowDecimal={allowDecimal}
            maxLength={maxLength}
            compact={compactKeys}
          />
        </View>
      </Surface>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  host: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
  },
  // fill: host kalan dikey alanı kaplar; içteki Numpad (fill) tuşları buna yayar.
  hostFill: { flex: 1 },
});

const modalStyles = StyleSheet.create({
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  label: { fontSize: 12, color: '#64748b', fontWeight: '500' },
  value: {
    fontSize: 26,
    fontWeight: '700',
    color: '#0f172a',
    fontFamily: 'monospace',
  },
  numpadWrap: { width: '100%', maxWidth: 480, alignSelf: 'center' },
});
