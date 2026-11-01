// =============================================================================
// Tablette yerinde yönetici onayı — yeniden bağlama (cihaz eşleme v2, plan §6.4)
// =============================================================================
// Kaldır-kur sonrası donanım özeti eski kaydı tanıdı ve eşleştirme zorunlu: panele gitmeden
// yönetici burada kullanıcı adı + parolayla (+ sunucu isterse 2FA) onaylar. JWT verilmez;
// parola/kod yalnız bileşen state'inde yaşar, gönderimden hemen sonra silinir, loglanmaz.
// =============================================================================
import React, { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Icon, Text, TouchableRipple } from 'react-native-paper';

import { deviceService } from '../../services/device.service';
import { palette } from '../../theme/tokens';
import { sanitizeAlphaInput } from './loginInput';

const USERNAME_MAX = 64;
const PASSWORD_MAX = 128;
const TOTP_MAX = 12;

type ApiErr = { status?: number; message?: string; details?: { code?: string; retryAfterSec?: number } } | null;

/** Sunucu hatası → Türkçe form iletisi. `totpNeeded` 2FA alanını açar. */
export function onsiteErrorMessage(err: unknown): { text: string; totpNeeded?: boolean; settled?: boolean } {
  const e = err as ApiErr;
  const code = e?.details?.code;
  switch (code) {
    case 'TOTP_REQUIRED':
      return { text: 'Bu hesap için doğrulama kodu gerekiyor. Kodu girip tekrar onaylayın.', totpNeeded: true };
    case 'TOTP_INVALID':
      return { text: 'Doğrulama kodu geçersiz.', totpNeeded: true };
    case 'TOTP_ENROLLMENT_REQUIRED':
      return { text: 'Bu hesapta iki adımlı doğrulama kurulmamış. Onayı panelden verin.' };
    case 'LOGIN_LOCKED': {
      const sec = Number(e?.details?.retryAfterSec) || 0;
      const wait = sec >= 60 ? `${Math.ceil(sec / 60)} dakika` : sec > 0 ? `${sec} saniye` : 'bir süre';
      return { text: `Çok fazla hatalı deneme — hesap kilitli. ${wait} sonra tekrar deneyin.` };
    }
    case 'AUTH_BUSY':
      return { text: 'Sunucu şu an çok yoğun. Birkaç saniye sonra tekrar deneyin.' };
    case 'REBIND_RATE_LIMITED':
      return { text: 'Çok fazla onay denemesi. Birkaç dakika sonra tekrar deneyin.' };
    case 'REBIND_APPROVER_FORBIDDEN':
      return { text: 'Bu hesabın cihaz yönetimi yetkisi (admin:settings) yok. Yetkili bir yöneticiyle onaylayın.' };
    case 'REBIND_ALREADY_DECIDED':
    case 'REBIND_REQUEST_NOT_FOUND':
      return { text: 'Bu talep zaten işlenmiş. Ekran birazdan güncellenir.', settled: true };
    default:
      break;
  }
  if (e?.status === 401) return { text: 'Kullanıcı adı veya parola hatalı.' };
  if (e?.status == null) return { text: 'Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.' };
  return { text: e?.message?.trim() || 'Onay verilemedi. Tekrar deneyin.' };
}

export interface OnsiteRebindApproveProps {
  localId: string;
  /** Başarı ya da "talep zaten işlenmiş": üst ekran durumu yeniden çeker (kanıt sırrı orada alınır). */
  onSettled: () => void;
}

/** Form durumu + gönderim: sır (parola/kod) gönderim anında state'ten silinir. */
function useOnsiteApprove(localId: string, onSettled: () => void) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [totpNeeded, setTotpNeeded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const trimmed = username.trim();
  const canSubmit =
    trimmed.length > 0 && password.length > 0 && (!totpNeeded || totp.trim().length > 0) && !submitting;

  const reset = () => {
    setOpen(false);
    setPassword('');
    setTotp('');
    setTotpNeeded(false);
    setError('');
  };

  const send = async () => {
    if (!canSubmit) return;
    const body = { localId, username: trimmed, password, ...(totpNeeded && totp.trim() ? { totp: totp.trim() } : {}) };
    setSubmitting(true);
    setError('');
    setPassword('');
    setTotp('');
    try {
      await deviceService.onsiteApproveRebind(body);
      reset();
      onSettled();
    } catch (err) {
      const m = onsiteErrorMessage(err);
      if (m.totpNeeded) setTotpNeeded(true);
      setError(m.text);
      if (m.settled) onSettled();
    } finally {
      setSubmitting(false);
    }
  };

  return {
    open, setOpen, username, setUsername, password, setPassword, totp, setTotp,
    totpNeeded, submitting, error, canSubmit, reset, send,
  };
}

type FieldProps = React.ComponentProps<typeof TextInput> & { label: string; inputRef?: React.Ref<TextInput> };

function Field({ label, inputRef, ...rest }: FieldProps) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        placeholderTextColor={palette.slate[400]}
        style={styles.input}
        {...rest}
      />
    </>
  );
}

function Actions({ f }: { f: ReturnType<typeof useOnsiteApprove> }) {
  return (
    <View style={styles.actions}>
      <TouchableRipple
        testID="yerinde-iptal"
        accessibilityRole="button"
        accessibilityLabel="İptal"
        onPress={f.reset}
        disabled={f.submitting}
        style={[styles.cancel, f.submitting && styles.disabled]}
      >
        <Text style={styles.cancelText}>İptal</Text>
      </TouchableRipple>
      <TouchableRipple
        testID="yerinde-onayla"
        accessibilityRole="button"
        accessibilityLabel="Onayla"
        accessibilityState={{ disabled: !f.canSubmit }}
        onPress={() => void f.send()}
        disabled={!f.canSubmit}
        style={[styles.submit, !f.canSubmit && styles.disabled]}
      >
        <View style={styles.btnInner}>
          {f.submitting ? (
            <ActivityIndicator size={18} color={palette.white} />
          ) : (
            <Icon source="check" size={20} color={palette.white} />
          )}
          <Text style={styles.submitText}>{f.submitting ? 'Onaylanıyor…' : 'Onayla'}</Text>
        </View>
      </TouchableRipple>
    </View>
  );
}

export default function OnsiteRebindApprove({ localId, onSettled }: OnsiteRebindApproveProps) {
  const f = useOnsiteApprove(localId, onSettled);
  const passwordRef = useRef<TextInput>(null);

  if (!f.open) {
    return (
      <TouchableRipple
        testID="yerinde-onay-ac"
        accessibilityRole="button"
        accessibilityLabel="Yönetici olarak burada onayla"
        onPress={() => f.setOpen(true)}
        style={styles.openBtn}
      >
        <View style={styles.btnInner}>
          <Icon source="shield-account-outline" size={20} color={palette.indigo[600]} />
          <Text style={styles.openText}>Yönetici olarak burada onayla</Text>
        </View>
      </TouchableRipple>
    );
  }

  return (
    <View style={styles.form} testID="yerinde-onay-formu">
      <Text style={styles.formTitle}>YÖNETİCİ ONAYI</Text>
      <Field
        label="Kullanıcı adı"
        testID="yerinde-kullanici-adi"
        value={f.username}
        onChangeText={(t) => f.setUsername(sanitizeAlphaInput(t, USERNAME_MAX))}
        editable={!f.submitting}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        placeholder="kullanıcı adı"
      />
      <Field
        label="Parola"
        inputRef={passwordRef}
        testID="yerinde-parola"
        value={f.password}
        onChangeText={(t) => f.setPassword(sanitizeAlphaInput(t, PASSWORD_MAX))}
        secureTextEntry
        editable={!f.submitting}
        returnKeyType="go"
        onSubmitEditing={() => void f.send()}
        placeholder="parola"
      />
      {f.totpNeeded && (
        <Field
          label="Doğrulama kodu (2FA)"
          testID="yerinde-totp"
          value={f.totp}
          onChangeText={(t) => f.setTotp(t.replace(/[^0-9A-Za-z-]/g, '').slice(0, TOTP_MAX))}
          keyboardType="number-pad"
          editable={!f.submitting}
          placeholder="6 haneli kod"
        />
      )}
      {!!f.error && (
        <View style={styles.errorRow}>
          <Icon source="alert-circle" size={18} color={palette.red[500]} />
          <Text style={styles.errorText} testID="yerinde-hata">
            {f.error}
          </Text>
        </View>
      )}
      <Actions f={f} />
      <Text style={styles.hint}>Onay kaydı yöneticinin adına yazılır.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  openBtn: {
    minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: palette.indigo[600],
    justifyContent: 'center', paddingHorizontal: 16, marginTop: 10,
  },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  openText: { color: palette.indigo[600], fontSize: 15, fontWeight: '600' },
  form: {
    marginTop: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: palette.slate[200],
    backgroundColor: palette.slate[50], gap: 6,
  },
  formTitle: { fontSize: 11, fontWeight: '700', color: palette.slate[500], letterSpacing: 0.8 },
  label: { fontSize: 13, color: palette.slate[600], marginTop: 4 },
  input: {
    minHeight: 50, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: palette.slate[300],
    backgroundColor: palette.white, color: palette.slate[900], fontSize: 16,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  errorText: { flex: 1, color: palette.red[500], fontSize: 13 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  cancel: {
    flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: palette.slate[300],
    justifyContent: 'center', alignItems: 'center',
  },
  cancelText: { color: palette.slate[600], fontSize: 15, fontWeight: '600' },
  submit: { flex: 2, minHeight: 48, borderRadius: 12, backgroundColor: palette.indigo[600], justifyContent: 'center' },
  submitText: { color: palette.white, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  hint: { fontSize: 11, color: palette.slate[400], marginTop: 4 },
});
