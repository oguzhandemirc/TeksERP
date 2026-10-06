/** `build-identity.ts` `channelPlugin`inin ürettiği sanal modül — alanlar `PanelIdentity` ile birebir. */
declare module "virtual:tekserp-channel" {
  export const code: string;
  export const name: string;
  export const appId: string;
  export const productName: string;
  export const packageName: string;
  export const updateFeedUrl: string;
  export const windowTitle: string;
  export const groupFeeds: Readonly<Record<string, string>>;
}
