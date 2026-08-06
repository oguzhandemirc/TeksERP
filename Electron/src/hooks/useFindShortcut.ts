import { useEffect } from "react";

/**
 * Ctrl/Cmd+F → sayfa içi arama çubuğunu aç (tarayıcıdaki davranış).
 *
 * ⚠️ `useGlobalShortcuts`e EKLENEMEZ: o hook ilk satırında değiştirici tuşlu
 * (ctrl/meta/alt) olayları eleyip çıkıyor — tek-tuş kısayolları (g, /, ?) için
 * doğru olan bu. Ctrl+F ise tam tersi bir olay sınıfı, o yüzden ayrı hook.
 *
 * ⚠️ `isTyping` guard'ı BİLEREK YOK: tarayıcıda bir metin kutusuna yazarken de
 * Ctrl+F aramayı açar. Kullanıcının kaslı hafızası budur; "bazı yerlerde
 * çalışmayan" bir kısayol, hiç olmayandan daha sinir bozucudur.
 *
 * F3 de bağlanır (Windows'ta "sonraki eşleşme" alışkanlığı) — çubuk kapalıysa
 * açar, açıksa odağı arama kutusuna geri verir.
 */
export function useFindShortcut(onOpen: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isFind = (e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F");
      const isF3 = e.key === "F3" && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (!isFind && !isF3) return;
      // Chromium'un kendi arama kutusunu (varsa) açmasını engelle.
      e.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}
