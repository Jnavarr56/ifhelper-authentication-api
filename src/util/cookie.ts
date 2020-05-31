import { REFRESH_TOKEN_COOKIE_NAME } from '../vars';
import { Request, Response } from 'express';
import TokenStore from '../models/TokenStore';
import { TokenStoreFields } from '../types/Token';

export const validateRefreshTokenCookie = (
	req: Request,
	res: Response,
	accessToken: string
): Promise<void> => {
	return new Promise((resolve, reject) => {
		if (req.cookies[REFRESH_TOKEN_COOKIE_NAME]) return resolve();

		TokenStore.findOne(
			{ access_token: accessToken },
			(error: unknown, tokenStore: TokenStoreFields | null) => {
				if (error) reject(error);
				if (!tokenStore) return reject('No Record of Token Store');

				res.cookie(REFRESH_TOKEN_COOKIE_NAME, tokenStore.refresh_token, {
					httpOnly: true,
					path: '/',
					expires: tokenStore.refresh_token_exp_date
				});

				resolve();
			}
		);
	});
};
