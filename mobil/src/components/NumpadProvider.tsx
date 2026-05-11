import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Surface } from 'react-native-paper';
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
}

export function NumpadHost({ style }: NumpadHostProps) {
  const { target, notifier } = useNumpadContext();
  useSyncExternalStore(notifier.subscribe, notifier.getSnapshot);

  const value = target ? target.getValue() : '';
  const onChange = target?.onChange ?? noop;
  const allowDecimal = target?.allowDecimal ?? true;
  const maxLength = target?.maxLength;
  const disabled = !target;

  return (
    <Surface style={[styles.host, style]} elevation={1}>
      <Numpad
        value={value}
        onChange={onChange}
        allowDecimal={allowDecimal}
        maxLength={maxLength}
        disabled={disabled}
      />
    </Surface>
  );
}

const noop = () => {};

const styles = StyleSheet.create({
  host: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
  },
});
