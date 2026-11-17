import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * Ekran yön kilitlerinin TEK sahibi (yığın). Her kilit isteyen ekran bir kayıt ekler,
 * çıkışta yalnız kendi kaydını siler; geçerli kilit en üstteki kayıttır. Yığın boşalınca
 * kilit BIRAKILIR (cihazın otomatik döndürmesi) — çıkışta yeniden kilitlemek tablette
 * giriş/kilit ekranını yatayda hapsediyordu.
 */
export type OrientationLockKind = 'LANDSCAPE' | 'PORTRAIT_UP';

interface LockEntry {
  id: number;
  kind: OrientationLockKind;
}

let nextId = 1;
const stack: LockEntry[] = [];
// Son uygulanan durum; null = kilitsiz (uygulamanın açılış durumu, app.json "default").
let applied: OrientationLockKind | null = null;

function apply(): void {
  const top = stack.length > 0 ? stack[stack.length - 1].kind : null;
  if (top === applied) return;
  applied = top;
  if (top === null) {
    void ScreenOrientation.unlockAsync();
  } else {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock[top]);
  }
}

/** Kilidi edinir; dönen fonksiyon yalnız bu kaydı bırakır (iki kez çağrılması zararsız). */
export function acquireOrientationLock(kind: OrientationLockKind): () => void {
  const entry: LockEntry = { id: nextId++, kind };
  stack.push(entry);
  apply();
  return () => {
    const i = stack.findIndex((e) => e.id === entry.id);
    if (i === -1) return;
    stack.splice(i, 1);
    apply();
  };
}
