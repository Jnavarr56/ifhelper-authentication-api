import jwt from "jsonwebtoken";
import cryptoRandomString from "crypto-random-string"
import RedisCacheManager from './RedisCacheManager'
import { UserRecord, AccessTokenPayload, RefreshTokenPayload, TokenData, TokenStoreFields, AccessTokenData, RefreshTokenData, TokenDataPair, TokenDataOpts, RequestWithIpInfo } from '../types/index'
import { Document } from 'mongoose'
import { TokenStore } from '../db/models'
import { RedisError } from "redis";
import { setRefreshTokenCookie } from "./cookie";
import { Response  } from "express";
require("dotenv").config();

const { JWT_SECRET_KEY, REDIS_PORT, REDIS_URL } = process.env;

const AuthTokenCache = new RedisCacheManager({
	port: parseInt(REDIS_PORT) || 6379,
	url: REDIS_URL,
	prefix: "AUTHENTICATION_TOKENS"
});

const generateSystemAuthToken = async (): Promise<string> => {
	const token: string = cryptoRandomString({ length: 10, type: "base64" });
	const payload: any = { access_type: "SYSTEM" };

	return new Promise((resolve) => {
		AuthTokenCache
			.setKey(token, payload, 60 * 60)
			.then(() => resolve(token))
	});
};


const createTokenData = (payload: AccessTokenPayload | RefreshTokenPayload, expiresInSecs: number = 0): TokenData => {
	const token: string = jwt.sign(		
		payload, 
		JWT_SECRET_KEY, 
		{ expiresIn: expiresInSecs }
	);
	const tokenDecoded: object | any = jwt.verify(token, JWT_SECRET_KEY);

	const { exp, iat } : { exp: number, iat: number } = tokenDecoded;
	const expDate: Date = new Date(exp * 1000);

	return { token, payload, exp, expDate, iat };
}

const createUserTokenData = (
		user: UserRecord, 
		options: TokenDataOpts = {},
	): TokenDataPair => {

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

	return { accessTokenData, refreshTokenData } 
};


const createTokenStore = (newTokenStoreData: TokenStoreFields): Promise<Document> => {
	return TokenStore.create(newTokenStoreData);
}

const cacheAccessToken = (accessTokenData: AccessTokenData): Promise<void | RedisError> => {
	return AuthTokenCache.setKey(
		accessTokenData.token, 
		accessTokenData, 
		accessTokenData.exp - accessTokenData.iat
	);
}

const generateUserTokenData = (user: UserRecord, opts: TokenDataOpts = {}, req: RequestWithIpInfo, res: Response): Promise<TokenDataPair> => {

	const { accessTokenData, refreshTokenData } = createUserTokenData(user, opts);

	return new Promise(async (resolve) => {

		await createTokenStore({
			user_id: user._id,
			access_token: accessTokenData.token,
			refresh_token: refreshTokenData.token,
			access_token_exp_date: accessTokenData.expDate,
			refresh_token_exp_date: refreshTokenData.expDate,
			requester_data: { ...req.useragent, ...req.ipInfo }
		});
	
		await cacheAccessToken(accessTokenData);
	
		setRefreshTokenCookie(res, refreshTokenData);
		
		const tokenData: TokenDataPair = { accessTokenData, refreshTokenData }

		resolve(tokenData);
	});
}


export { generateSystemAuthToken, generateUserTokenData, createTokenStore, createUserTokenData, cacheAccessToken };
