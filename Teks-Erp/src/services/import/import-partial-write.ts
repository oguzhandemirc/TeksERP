// İki adımlı yazımda (kayıt + ayrı tx'li çocuk) ikinci adım düşerse fırlatılır: ilk adımın
// yarattığı/güncellediği kayıt deftere YİNE basılsın ki içe aktarım geri sarmasıyla geri alınabilsin.
export class ImportPartialWriteError extends Error {
  constructor(
    readonly recordId: string,
    readonly original: unknown,
  ) {
    super(original instanceof Error ? original.message : "Yazma sırasında beklenmedik hata.");
    this.name = "ImportPartialWriteError";
  }
}
