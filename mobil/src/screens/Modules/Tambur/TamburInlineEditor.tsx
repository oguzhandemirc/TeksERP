// Etiket önizlemesinde YERİNDE düzenleme kutusu (2026-11-10, kullanıcı): dokunulan elemanın konumunda açılır; sayı →
// uygulamanın numpad'i, metin → klavye. Onay (✓ / klavye "bitti" / numpad kapanınca / odak kaybı) değeri state'e yazar;
// ✕ vazgeçer. Kutu kâğıdın içine sıkıştırılır (taşmaz).
import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, TextInput } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import { palette } from '../../../theme/tokens';

/** Elemanın kâğıt üstündeki çapası (px). */
export interface EditAnchor {
  x: number;
  y: number;
  h: number;
  align: 'left' | 'center' | 'right';
}

const BOX_H = 52;
const BTN = 44;

/** Kutu yerleşimi: çapa hizasına göre, kâğıdın içinde kalacak biçimde. Saf (birim test). */
export function editorRect(a: EditAnchor, paper: { w: number; h: number }) {
  const w = Math.min(paper.w, Math.max(220, paper.w * 0.5));
  const rawLeft = a.align === 'right' ? a.x - w : a.align === 'center' ? a.x - w / 2 : a.x;
  const left = Math.max(0, Math.min(paper.w - w, rawLeft));
  const rawTop = a.y + a.h / 2 - BOX_H / 2;
  const top = Math.max(0, Math.min(Math.max(0, paper.h - BOX_H), rawTop));
  return { left, top, width: w, height: BOX_H };
}

export interface TamburInlineEditorProps {
  kind: 'number' | 'text';
  label: string;
  initial: string;
  placeholder?: string;
  maxLength: number;
  rect: { left: number; top: number; width: number; height: number };
  onCommit: (v: string) => void;
  onCancel: () => void;
}

export default function TamburInlineEditor(p: TamburInlineEditorProps) {
  const [draft, setDraft] = useState(p.initial);
  const done = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const commit = () => {
    if (done.current) return;
    done.current = true;
    p.onCommit(draftRef.current.trim());
  };
  // Odak kaybı ✕'ten önce yazmış olabilir → ilk değere geri yaz.
  const cancel = () => {
    if (done.current) p.onCommit(p.initial);
    done.current = true;
    p.onCancel();
  };
  const wasActive = useRef(false);
  const input =
    p.kind === 'number' ? (
      <NumpadInput
        dense
        mode="outlined"
        value={draft}
        onChangeText={setDraft}
        numpadLabel={p.label}
        allowDecimal
        numpadMaxLength={p.maxLength}
        autoActivate
        placeholder={p.placeholder}
        onFocusChange={(active) => {
          // Numpad kapanınca (hedef bırakıldı) değer yazılır.
          if (active) wasActive.current = true;
          else if (wasActive.current) commit();
        }}
        onSubmitEditing={commit}
        style={s.input}
        testID="onizleme-yerinde"
      />
    ) : (
      <TextInput
        dense
        mode="outlined"
        value={draft}
        onChangeText={(t) => setDraft(t.slice(0, p.maxLength))}
        autoFocus
        placeholder={p.placeholder}
        returnKeyType="done"
        onSubmitEditing={commit}
        onBlur={commit}
        style={s.input}
        accessibilityLabel={p.label}
        testID="onizleme-yerinde"
      />
    );
  return (
    <View style={[s.box, p.rect]} testID="onizleme-yerinde-kutu">
      <View style={{ flex: 1 }}>{input}</View>
      <IconButton icon="check" mode="contained" size={20} onPress={commit} style={s.btn} accessibilityLabel="Onayla" testID="onizleme-onay" />
      <IconButton icon="close" size={20} onPress={cancel} style={s.btn} accessibilityLabel="Vazgeç" testID="onizleme-vazgec" />
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: palette.white,
    borderWidth: 2,
    borderColor: palette.blue[600],
    elevation: 6,
  },
  input: { fontSize: 18, backgroundColor: palette.white },
  btn: { margin: 0, width: BTN, height: BTN },
});
