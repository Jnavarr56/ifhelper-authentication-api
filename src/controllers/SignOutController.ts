import * as e from 'express';
import * as dotenv from 'dotenv';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import BaseController from './BaseController';
import {
	AccessTokenPayload,
	SystemAccessTokenPayload,
	DecodedAccessTokenPayload
} from '../types/Token';
import TokenBlacklist from '../util/TokenBlacklist';
import AuthTokenCache from '../util/AuthTokenCache';

dotenv.config();

const JWT_SECRET_KEY: string | undefined = process.env.JWT_SECRET_KEY;

const authTokenCache: AuthTokenCache = new AuthTokenCache();
const tokenBlacklist: TokenBlacklist = new TokenBlacklist();

export default class SignOutController extends BaseController {
	protected async executeImpl(req: e.Request, res: e.Response): Promise<void> {
		// 1) make sure token is present in request.
		const accessToken: string | undefined = req.token;
		if (!accessToken) {
			return this.missingAuthorizationToken(res);
		}

		// 2) check to make sure token is not blacklisted, if so reject.
		const isBlacklisted = await tokenBlacklist.isBlacklisted(accessToken);
		if (isBlacklisted) {
			return this.invalidToken(res);
		}

		// 3) Check for a cached token payload.
		const cachedPayload:
			| AccessTokenPayload
			| SystemAccessTokenPayload
			| null = await authTokenCache.getCachedPayload(accessToken);

		// 4) If in cache then is valid, blacklist this token.
		if (cachedPayload !== null) {
			const currentTTL: number = await authTokenCache.getTTL(accessToken);
			await tokenBlacklist.blacklistToken(accessToken, currentTTL);
			return this.ok(res);
		}

		// 4) If not in cache, decode manually.
		if (typeof JWT_SECRET_KEY !== 'string')
			throw new Error('Invalid JWT Secret Key');

		jwt.verify(
			accessToken,
			JWT_SECRET_KEY,
			async (error: Error | null, decodedToken: any) => {
				// 6) reject if expired or invalid.
				if (error) {
					if (error instanceof TokenExpiredError) {
						return this.expiredToken(res);
					} else {
						return this.invalidToken(res);
					}
				}

				const decodedPayload: DecodedAccessTokenPayload = decodedToken;

				// 7) blacklist token for remaining life span
				const ttl: number = decodedPayload.exp - decodedPayload.iat;
				await tokenBlacklist.blacklistToken(accessToken, ttl);
				return this.ok(res);
			}
		);
	}
}
