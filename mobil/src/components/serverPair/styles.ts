// Sunucu ekleme akışının ortak stilleri (renkler ayarlar sayfasının jetonlarından).
import { StyleSheet } from 'react-native';

import { SETTINGS_COLORS as C } from '../../screens/Common/settings/settingsUi';

export { C };

export const styles = StyleSheet.create({
  root: { gap: 16, width: '100%' },
  notice: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.warning,
    backgroundColor: C.bgDarker,
  },
  noticeText: { color: C.text, fontSize: 15, lineHeight: 22, flex: 1 },
  choices: { gap: 16 },
  choicesWide: { flexDirection: 'row', alignItems: 'stretch' },
  choice: {
    gap: 12,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgSoft,
  },
  choiceWide: { flex: 1 },
  choiceTitle: { color: C.text, fontSize: 20, fontWeight: '700' },
  choiceBody: { color: C.subtext, fontSize: 15, lineHeight: 22, flexGrow: 1 },
  panel: {
    gap: 14,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgSoft,
  },
  stepTitle: { color: C.text, fontSize: 22, fontWeight: '700' },
  body: { color: C.text, fontSize: 16, lineHeight: 23, flexShrink: 1 },
  hint: { color: C.subtext, fontSize: 14, lineHeight: 20 },
  input: { backgroundColor: C.bgDarker },
  inputContent: { fontSize: 22, minHeight: 64 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  code: {
    color: C.text,
    fontFamily: 'monospace',
    fontSize: 26,
    lineHeight: 40,
    letterSpacing: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: C.bgDarker,
    textAlign: 'center',
  },
  confirmRow: { gap: 12 },
  confirmRowWide: { flexDirection: 'row' },
  flex1: { flex: 1 },
  error: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 12,
    backgroundColor: C.errorBg,
  },
  errorText: { color: C.text, fontSize: 15, lineHeight: 22, flex: 1 },
});
