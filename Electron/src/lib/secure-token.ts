const TOKEN_KEY = "auth.token";

export const tokenStore = {
  async get(): Promise<string | null> {
    return window.api.secureStore.get(TOKEN_KEY);
  },
  async set(token: string): Promise<void> {
    await window.api.secureStore.set(TOKEN_KEY, token);
  },
  async clear(): Promise<void> {
    await window.api.secureStore.delete(TOKEN_KEY);
  },
};
