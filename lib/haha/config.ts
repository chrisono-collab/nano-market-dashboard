function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value === "REPLACE_ME") {
    throw new Error(
      `Missing ${name} — set it in .env.local (see .env.local for placeholders).`
    );
  }
  return value;
}

export const hahaConfig = {
  get appKey() {
    return requireEnv("HAHA_APP_KEY");
  },
  get appSecret() {
    return requireEnv("HAHA_APP_SECRET");
  },
  get baseUrl() {
    return process.env.HAHA_API_BASE_URL ?? "https://thor-openapi.hahavending.com";
  },
  apiVersionPath: "/open/api/v1",
};
