import { computeAutoUrl } from '../store/baseUrlStore';

/** Derleme anı önerisi (dev-host / gömülü `EXPO_PUBLIC_API_URL`); ortak pakette BOŞ — tek kural `autoUrlFrom`. */
export const API_URL = computeAutoUrl();

/** Ekranı bekleten bootstrap GET'lerinin timeout'u (login ekranı verileri,
 *  work-sessions/current). Global 10sn mutasyonlar için kalır; kullanıcının
 *  boş ekrana baktığı isteklerde 5sn'den fazlası "donma" olarak algılanır —
 *  SWR cache'i + arka plan tazeleme zaten devrede (SAHA-AG-DAYANIKLILIK.md §S2). */
export const BOOTSTRAP_TIMEOUT_MS = 5_000;
