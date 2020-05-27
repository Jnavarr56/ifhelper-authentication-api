import jwt from "jsonwebtoken";
import cryptoRandomString from "crypto-random-string";
import RedisCacheManager from "./RedisCacheManager";
import {
	UserRecord,
	AccessTokenPayload,
	RefreshTokenPayload,
	TokenData,
	AccessTokenData,
	RefreshTokenData,
	TokenDataPair,
	TokenDataOpts
} from "../types/index";
import { TokenStore } from "../db/models";
require("dotenv").config();

const { JWT_SECRET_KEY, REDIS_PORT, REDIS_URL } = process.env;

const AuthTokenCache = new RedisCacheManager({
	port: parseInt(REDIS_PORT) || 6379,
	url: REDIS_URL,
	prefix: "AUTHENTICATION_TOKENS"
});

const TokenBlacklistCache = new RedisCacheManager({
	port: parseInt(REDIS_PORT) || 6379,
	url: REDIS_URL,
	prefix: "AUTHENTICATION_TOKENS_BLACKLIST"
});

export async function generateSystemAuthToken(): Promise<string> {
	const token: string = cryptoRandomString({ length: 10, type: "base64" });
	const payload: any = { access_type: "SYSTEM" };

	return new Promise((resolve) => {
		AuthTokenCache.setKey(token, payload, 60 * 60).then(() => resolve(token));
	});
}

function createTokenData(
	payload: AccessTokenPayload | RefreshTokenPayload,
	expiresInSecs = 0
): TokenData {
	const token: string = jwt.sign(payload, JWT_SECRET_KEY, {
		expiresIn: expiresInSecs
	});
	const tokenDecoded: any = jwt.verify(token, JWT_SECRET_KEY);

	const { exp, iat }: { exp: number; iat: number } = tokenDecoded;
	const expDate: Date = new Date(exp * 1000);

	return { token, payload, exp, expDate, iat };
}

export function createUserTokenData(
	user: UserRecord,
	options: TokenDataOpts = {}
): TokenDataPair {
	const { access_level, _id } = user;

	const { accessTokenExpiresInSecs = 60 * 60 } = options;
	const accessTokenPayload: AccessTokenPayload = {
		access_type: "USER",
		authenticated_user: { access_level, _id }
	};
	const accessTokenData: AccessTokenData = createTokenData(
		accessTokenPayload,
		accessTokenExpiresInSecs
	);

	const { refreshTokenExpiresInSecs = 60 * 60 * 24 * 7 } = options;
	const refreshTokenPayload: RefreshTokenPayload = { _id };
	const refreshTokenData: RefreshTokenData = createTokenData(
		refreshTokenPayload,
		refreshTokenExpiresInSecs
	);

	return { accessTokenData, refreshTokenData };
}

export async function blacklistAllTokens(userID: string): Promise<void> {
	const stores: any = await TokenStore.find({
		user_id: userID,
		access_token_exp_date: { $gte: new Date() }
	});

	const storeArr: Array<any> = Array.isArray(stores) ? stores : [stores];
	// add access token in each tokenstore to the black list
	for (const store of storeArr) {
		const notYetBlacklisted: boolean = await TokenBlacklistCache.getKey(
			store.access_token
		).then((payload) => payload === null);

		if (notYetBlacklisted) {
			const ttl: number = Math.ceil(
				(store.access_token_exp_date - store.createdAt) / 1000
			);
			await TokenBlacklistCache.setKey(store.access_token, {}, ttl);
		}
	}
}
