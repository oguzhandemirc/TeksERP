/** `build-channel.ts` `channelPlugin`inin ürettiği sanal modül — alanlar `PanelChannel` ile birebir. */
declare module "virtual:tekserp-channel" {
  export const code: string;
  export const name: string;
  export const label: string | null;
  export const appId: string;
  export const productName: string;
  export const packageName: string;
  export const erpUrl: string;
  export const updateFeedUrl: string;
  export const windowTitle: string;
}
