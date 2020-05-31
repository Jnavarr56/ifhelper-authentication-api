import * as e from 'express';
import User from '../util/User';
import {
	TokenDataPair,
	AccessTokenData,
	RefreshTokenData,
	NewTokenStoreFields
} from '../types/Token';
import { SignInResponse } from '../types/Response';

import BaseController from './BaseController';
import AuthTokenCache from '../util/AuthTokenCache';
import { generateUserTokenData } from '../util/tokens';
import TokenStore from '../models/TokenStore';

const authTokenCache = new AuthTokenCache();

export default class SignInController extends BaseController {
	protected async executeImpl(req: e.Request, res: e.Response): Promise<void> {
		// 1) make sure email and password are present in the request.
		const email: string | undefined = req.body.email;
		const password: string | undefined = req.body.password;
		if (!email || !password) {
			return this.missingParams(res, ['email', 'password']);
		}

		// 2) locate user based on supplied email.
		const user: User = new User();
		await user.initByEmail(email);

		// 3) if user does not exist or password is wrong then reject.
		if (!user.exists() || !(await user.hasPassword(password))) {
			return this.unauthorized(res, 'Email/Password Combination Not Recognized');
		} else if (!user.confirmedEmail()) {
			// 3) if user exists but never confirmed email then reject.
			return this.unauthorized(res, 'Email Not Confirmed');
		}

		// 5) initialize user tokens
		const userTokenData: TokenDataPair = generateUserTokenData(user.getFields());
		const accessTokenData: AccessTokenData = userTokenData.accessTokenData;
		const refreshTokenData: RefreshTokenData = userTokenData.refreshTokenData;

		// 6) cache user token data
		await authTokenCache.cacheToken(
			accessTokenData.token,
			accessTokenData.payload,
			accessTokenData.exp - accessTokenData.iat
		);

		// 7) save token data to db
		const tokenStoreData: NewTokenStoreFields = {
			user_id: user.getFields()._id,
			access_token: accessTokenData.token,
			refresh_token: refreshTokenData.token,
			access_token_exp_date: accessTokenData.expDate,
			refresh_token_exp_date: refreshTokenData.expDate,
			requester_data: req.useragent
		};

		await TokenStore.create(tokenStoreData);

		// 8) format at send
		const response: SignInResponse = {
			access_token: accessTokenData.token,
			...accessTokenData.payload
		};

		this.ok(res, response);
	}
}
