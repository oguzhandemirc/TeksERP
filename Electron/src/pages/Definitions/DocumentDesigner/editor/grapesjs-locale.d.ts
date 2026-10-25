// GrapesJS dil dosyaları tip tanımı taşımaz; yalnız iç içe metin nesnesidir.
declare module "grapesjs/locale/*.mjs" {
  const messages: Record<string, unknown>;
  export default messages;
}
