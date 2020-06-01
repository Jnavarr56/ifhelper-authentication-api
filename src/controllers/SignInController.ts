import * as e from 'express';
import User from '../util/User';
import { TokenDataPair, AccessTokenData } from '../types/Token';
import { SignInResponse } from '../types/Response';

import BaseController from './BaseController';

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

		// 4) initialize user tokens and persist
		const userTokenData: TokenDataPair = await user.generateUserTokenData(
			req,
			res
		);
		const accessTokenData: AccessTokenData = userTokenData.accessTokenData;

		// 5) format and send
		const response: SignInResponse = {
			access_token: accessTokenData.token,
			...accessTokenData.payload
		};
		this.ok(res, response);
	}
}
