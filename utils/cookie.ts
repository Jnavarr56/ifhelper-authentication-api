import { RequestWithIpInfo } from "../types";
import { Response } from "express";
import { TokenStore } from "../db/models";
import { REFRESH_TOKEN_COOKIE_NAME } from "../vars";

export function validateRefreshTokenCookie(
	req: RequestWithIpInfo,
	res: Response,
	accessToken: string
): Promise<void> {
	return new Promise(async (resolve, reject) => {
		if (req.cookies[REFRESH_TOKEN_COOKIE_NAME]) return resolve();

		TokenStore.findOne(
			{ access_token: accessToken },
			(error, tokenStore: any) => {
				if (error) reject(error);
				if (!tokenStore) reject("NO RECORD OF TOKEN STORE");

				res.cookie(REFRESH_TOKEN_COOKIE_NAME, tokenStore.refresh_token, {
					httpOnly: true,
					path: "/",
					expires: tokenStore.refresh_token_exp_date
				});

				resolve();
			}
		);
	});
}
