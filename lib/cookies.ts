const API_KEY_COOKIE = "china-train-api-key";
const MAX_AGE_DAYS = 365;

export function getApiKeyFromCookie(): string {
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + encodeURIComponent(API_KEY_COOKIE) + "=([^;]*)")
  );
  const value = match ? decodeURIComponent(match[1]) : "";
  return value;
}

export function setApiKeyCookie(value: string): void {
  const encoded = encodeURIComponent(value);
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${API_KEY_COOKIE}=${encoded}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function clearApiKeyCookie(): void {
  document.cookie = `${API_KEY_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}
