export const PORT = 80;
export const REDIS_PORT = 6379;
export const REDIS_URL = "redis://cache";
export const PATHNAME = "/api/authentication";
export const USERS_API = "http://users-api/api/users";
export const ACCESS_TOKEN_LIFE_SECS = 60 * 60;
export const REFRESH_TOKEN_LIFE_SECS = 60 * 60 * 24 * 14;
export const REFRESH_TOKEN_COOKIE_NAME = "_ifhelper_ref";
export const AUTH_TOKEN_CACHE_PREFIX = "AUTHENTICATION_TOKENS";
export const BLACKLIST_TOKEN_CACHE_PREFIX = "AUTHENTICATION_TOKENS_BLACKLIST";
