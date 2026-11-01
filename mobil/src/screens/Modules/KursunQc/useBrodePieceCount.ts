// GK-H1b: "Brode adedi" alanının durumu — top değişince sıfırlanır; adet yalnız GİRİLDİĞİ topun
// çıkış okumasına eklenir. Boş/geçersiz adette dokunuş baştan durur (sayaç okunmaz, istek gitmez).
import { useEffect, useState } from 'react';
import Toast from 'react-native-toast-message';
import type { CompleteQc2Request } from '../../../services/kursunQc.service';
import type { GramajTapInput } from './useGramajTap';
import { parsePieceCount, withPieceCount, type PieceInputMode } from './brodePiece';

export interface BrodePieceState {
  mode: PieceInputMode | null;
  text: string;
  setText: (t: string) => void;
  /** Son başarısız dokunuşun sebebi — alanın ALTINDA görünür (toast modalın arkasında kalabiliyor). */
  error: string | null;
  /** Her başarısız dokunuşta artar; alan bunu görünce kendine odaklanır. */
  focusRequest: number;
  /** Dokunuş öncesi denetim; kapalıyken hep true. */
  precheck: (rollId: string) => boolean;
  /** Gövdeye adedi ekler (kapalıyken ya da başka topun gövdesinde aynen döner). */
  attach: (vars: CompleteQc2Request) => CompleteQc2Request;
}

export function useBrodePieceCount(mode: PieceInputMode | null, rollId: string | null): BrodePieceState {
  const [text, setRawText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    setRawText('');
    setError(null);
  }, [rollId]);
  const setText = (t: string) => {
    setRawText(t);
    setError(null);
  };
  const precheck = (rid: string): boolean => {
    if (!mode || rid !== rollId) return true;
    const parsed = parsePieceCount(text);
    if (!parsed.ok) {
      Toast.show({ type: 'error', text1: 'Brode adedi eksik', text2: parsed.message });
      setError(parsed.message);
      setFocusRequest((n) => n + 1);
    }
    return parsed.ok;
  };
  // Ön koşul: çağıran önce `precheck`ten geçer (pieceGatedTap); geçersiz adet burada sessizce düşer.
  const attach = (vars: CompleteQc2Request): CompleteQc2Request => {
    if (!mode || vars.rollId !== rollId) return vars;
    const parsed = parsePieceCount(text);
    return parsed.ok ? withPieceCount(vars, parsed.value) : vars;
  };
  return { mode, text, setText, error, focusRequest, precheck, attach };
}

/** Gramaj dokunuşuna adet kapısını ekler: önce adet denetimi, sonra içteki (en) kapısı. */
export function pieceGatedTap(
  piece: Pick<BrodePieceState, 'precheck' | 'attach'>,
  inner: Pick<GramajTapInput, 'complete' | 'precheck'>,
): Pick<GramajTapInput, 'complete' | 'precheck'> {
  return {
    complete: (vars, opts) => inner.complete(piece.attach(vars), opts),
    precheck: (rollId) => piece.precheck(rollId) && inner.precheck?.(rollId) !== false,
  };
}
