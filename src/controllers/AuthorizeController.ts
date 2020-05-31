import * as e from 'express';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import BaseController from './BaseController';
import { REFRESH_TOKEN_COOKIE_NAME } from '../vars';
import { AuthorizationResponse } from '../types/Response';
import {
	AccessTokenPayload,
	SystemAccessTokenPayload,
	DecodedAccessTokenPayload
} from '../types/Token';
import TokenBlacklist from '../util/TokenBlacklist';
import AuthTokenCache from '../util/AuthTokenCache';
import { validateRefreshTokenCookie } from '../util/cookie';

const authTokenManager: AuthTokenCache = new AuthTokenCache();
const tokenBlacklistManager: TokenBlacklist = new TokenBlacklist();

export default class AuthorizeController extends BaseController {
	protected async executeImpl(req: e.Request, res: e.Response): Promise<void> {
		// 1) make sure token is present in request.
		const accessToken: string | undefined = req.token;
		if (!accessToken) {
			return this.missingAuthorizationToken(res);
		}

		// 2) check to make sure token is not blacklisted, if so reject.
		const isBlacklisted = await tokenBlacklistManager.isBlacklisted(accessToken);
		if (isBlacklisted) {
			res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
			return this.unauthorized(res, 'Token Invalid');
		}

		// 4) Check for cached a payload and return if exists.
		const cachedPayload:
			| AccessTokenPayload
			| SystemAccessTokenPayload
			| null = await authTokenManager.getCachedPayload(accessToken);

		if (cachedPayload !== null) {
			const response: AuthorizationResponse = cachedPayload;
			return this.ok(res, response);
		}

		// 5) if not cached then decoded manually.
		const JWT_SECRET_KEY: string | undefined = process.env.JWT_SECRET_KEY;
		if (typeof JWT_SECRET_KEY !== 'string')
			throw new Error('Invalid JWT Secret Key');

		jwt.verify(
			accessToken,
			JWT_SECRET_KEY,
			async (error: Error | null, decodedToken: any) => {
				// 6) reject if expired or invalid.
				if (error) {
					if (error instanceof TokenExpiredError) {
						return this.unauthorized(res, 'Token Expired');
					} else {
						return this.unauthorized(res, 'Token Invalid');
					}
				}

				// 6) set in cache for remainder of lifespan and respond with the payload.
				const decodedPayload: DecodedAccessTokenPayload = decodedToken;

				const { exp, iat, ...payload } = decodedPayload;
				const ttl: number = exp - iat;

				const accessTokenPayload: AccessTokenPayload = { ...payload };

				await authTokenManager.cacheToken(accessToken, payload, ttl);
				await validateRefreshTokenCookie(req, res, accessToken);

				const response: AuthorizationResponse = accessTokenPayload;

				return res.send(response);
			}
		);
	}
}
