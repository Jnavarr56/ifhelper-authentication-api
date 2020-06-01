import * as e from 'express';
import * as dotenv from 'dotenv';
import jwt, { TokenExpiredError } from 'jsonwebtoken';

import { RefreshResponse } from '../types/Response';
import { TokenDataPair, AccessTokenData } from '../types/Token';

import TokenStore from '../models/TokenStore';
import User from '../util/User';
import TokenBlacklist from '../util/TokenBlacklist';

import BaseController from './BaseController';

import { REFRESH_TOKEN_COOKIE_NAME } from '../vars';

dotenv.config();

const JWT_SECRET_KEY: string | undefined = process.env.JWT_SECRET_KEY;

const tokenBlacklistManager: TokenBlacklist = new TokenBlacklist();

export default class RefreshController extends BaseController {
	protected async executeImpl(req: e.Request, res: e.Response): Promise<void> {
		// 1) make sure token is present in request.
		const accessToken: string | undefined = req.token;
		if (!accessToken) {
			return this.missingAuthorizationToken(res);
		}

		// 2) make sure refresh token is in the httpOnly cookie.
		const refreshToken: string | undefined =
			req.cookies[REFRESH_TOKEN_COOKIE_NAME];
		if (!refreshToken) {
			return this.unauthorized(res, 'Refresh Token Invalid');
		}

		// 3) check to make sure token is not blacklisted, if so reject.
		const isBlacklisted = await tokenBlacklistManager.isBlacklisted(accessToken);
		if (isBlacklisted) {
			return this.invalidToken(res);
		}

		// 4) make sure that access token matches the refresh token and
		// that they have not been revoked and that the refresh token
		// has not expired.
		const tokenStore: any = await TokenStore.findOne({
			access_token: accessToken,
			refresh_token: refreshToken,
			refresh_token_exp_date: { $gte: new Date() },
			revoked: false
		});
		if (!tokenStore) {
			res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
			return this.invalidToken(res);
		}

		// 5) make sure access tokens are valid (the only issue with them)
		// is that they are expired.
		if (typeof JWT_SECRET_KEY !== 'string')
			throw new Error('Invalid JWT Secret Key');
		try {
			jwt.verify(accessToken, JWT_SECRET_KEY);
			jwt.verify(refreshToken, JWT_SECRET_KEY);
		} catch (error) {
			if (!(error instanceof TokenExpiredError)) {
				return this.invalidToken(res);
			}
		}

		// 5) locate the user associated with this token. reject
		// if they do not exist.
		const user = new User();
		await user.initByID(tokenStore.user_id);
		if (!user.exists()) return this.invalidToken(res);

		// 6) initialize user tokens
		const userTokenData: TokenDataPair = await user.generateUserTokenData(
			req,
			res
		);
		const accessTokenData: AccessTokenData = userTokenData.accessTokenData;

		// 7) format and send
		const response: RefreshResponse = {
			access_token: accessTokenData.token,
			...accessTokenData.payload
		};
		this.ok(res, response);
	}
}
