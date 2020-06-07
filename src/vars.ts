export const PORT = 80;
export const REDIS_PORT = 6379;
export const REDIS_URL = 'redis://authentication-api-cache';
export const RABBIT_MQ_URL = 'amqp://messenger';
export const AUTHORIZATION_QUEUE_NAME = 'AUTHORIZATION_QUEUE';
export const PATHNAME = '/api/authentication';
export const USERS_API = 'http://users-api/api/users';
export const ACCESS_TOKEN_LIFE_SECS = 3600;
export const REFRESH_TOKEN_LIFE_SECS = 1209600;
export const REFRESH_TOKEN_COOKIE_NAME = '_ifhelper_ref';
export const AUTH_TOKEN_CACHE_PREFIX = 'AUTHENTICATION_TOKENS';
export const BLACKLIST_TOKEN_CACHE_PREFIX = 'AUTHENTICATION_TOKENS_BLACKLIST';
export const GOOGLE_OAUTH_SCOPE = [
	'https://www.googleapis.com/auth/plus.login',
	'https://www.googleapis.com/auth/userinfo.profile',
	'https://www.googleapis.com/auth/userinfo.email'
];
export const CLIENT_ORIGIN = 'http://localhost:3000';
