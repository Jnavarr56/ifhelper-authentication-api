import express, { Application } from "express";
import RedisCacheManager from "./utils/RedisCacheManager";
import User from "./utils/User";
import { SignInResponse, AccessTokenPayload } from "./types/index";
import useragent from "express-useragent";
import bodyParser from "body-parser";
import bearerToken from "express-bearer-token";
import expressip from "express-ip";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import cors from "cors";
import { TokenStore } from "./db/models";
import mongoose, { ConnectionOptions } from "mongoose";
import jwt from "jsonwebtoken";
import { RequestWithIpInfo } from "./types/index";

require("dotenv").config();

const {
	PORT = 3000,
	REDIS_PORT,
	REDIS_URL,
	MONGO_DB_URL,
	JWT_SECRET_KEY,
	REFRESH_TOKEN_COOKIE_NAME
} = process.env;

const API_BASE_URL: string =
	typeof process.env.API_BASE_URL === "string"
		? process.env.API_BASE_URL
		: "/api";
const PATHNAME = "/authentication";

const app: Application = express();

app
	.use(bodyParser.urlencoded({ extended: true }))
	.use(bodyParser.json())
	.use(useragent.express())
	.use(expressip().getIpInfoMiddleware)
	.use(bearerToken())
	.use(cookieParser())
	.use(morgan("dev"));

if (process.env.NODE_ENV !== "production") {
	app.use(cors());
}

const AuthTokenCache: RedisCacheManager = new RedisCacheManager({
	port: parseInt(REDIS_PORT) || 6379,
	url: REDIS_URL,
	prefix: "AUTHENTICATION_TOKENS"
});

const TokenBlacklistCache: RedisCacheManager = new RedisCacheManager({
	port: parseInt(REDIS_PORT) || 6379,
	url: REDIS_URL,
	prefix: "AUTHENTICATION_TOKENS_BLACKLIST"
});

// user inactivation check?
// model types
// cache types

// public
app.post(
	`${API_BASE_URL}${PATHNAME}/sign-in`,
	async (req: RequestWithIpInfo, res) => {
		const { email, password } = req.body;

		if (!email || !password) {
			return res.status(400).send({ error_code: "MISSING EMAIL OR PASSWORD" });
		}

		// 1) try to locate user by email
		const user: User = new User();
		await user.initByEmail(email);

		// 2) reject if user does not exist/wrong pwd/email not confirmed
		if (!user.exists() || !user.hasPassword(password)) {
			return res.status(401).send({
				error_code: "EMAIL/PASSWORD COMBINATION NOT RECOGNIZED"
			});
		} else if (!user.confirmedEmail()) {
			return res.status(401).send({
				error_code: "EMAIL NOT CONFIRMED"
			});
		}

		// 3) produce tokens for user
		user.initUserTokens().then(async ({ accessTokenData, refreshTokenData }) => {
			// 4) save token data to database
			await TokenStore.create({
				user_id: user.getFields()._id,
				access_token: accessTokenData.token,
				refresh_token: refreshTokenData.token,
				access_token_exp_date: accessTokenData.expDate,
				refresh_token_exp_date: refreshTokenData.expDate,
				requester_data: { ...req.useragent, ...req.ipInfo }
			});

			// 5) set access token payload in the cache
			await AuthTokenCache.setKey(
				accessTokenData.token,
				accessTokenData.payload,
				accessTokenData.exp - accessTokenData.iat
			);
			// await cacheAccessToken(accessTokenData);

			// 6) set refresh token in a cookie
			res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshTokenData.token, {
				httpOnly: true,
				expires: refreshTokenData.expDate,
				sameSite: true
			});

			// 7) format and send
			const dataToSend: SignInResponse = {
				access_token: accessTokenData.token,
				...accessTokenData.payload
			};

			res.send(dataToSend);
		});
	}
);

// token required
app.get(
	`${API_BASE_URL}${PATHNAME}/authorize`,
	async (req: RequestWithIpInfo, res) => {
		const { token: accessToken } = req;

		if (!accessToken) {
			return res.status(400).send({
				error_code: "MISSING AUTHORIZATION BEARER TOKEN"
			});
		}

		// 1) check if token has been blacklisted, reject if so
		const isBlacklisted: boolean =
			(await TokenBlacklistCache.getKey(accessToken)) !== null;

		if (isBlacklisted) {
			res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
			return res.status(401).send({ error_code: "TOKEN INVALID" });
		}

		// 2) check if token's payload is in the cache, send if so
		const cachedPayload: any = await AuthTokenCache.getKey(accessToken);
		if (cachedPayload !== null) {
			if (cachedPayload.access_type === "SYSTEM") {
				// delete system tokens after use to avoid clogging memory
				await AuthTokenCache.deleteKey(accessToken);
			} else if (!req.cookies[REFRESH_TOKEN_COOKIE_NAME]) {
				const tokenStore: any = await TokenStore.findOne({
					access_token: accessToken
				});
				res.cookie(REFRESH_TOKEN_COOKIE_NAME, tokenStore.refresh_token, {
					httpOnly: true,
					expires: tokenStore.refresh_token_exp_date
				});
			}

			return res.send(cachedPayload);
		}

		// 3) decode token since not in cache
		jwt.verify(
			accessToken,
			JWT_SECRET_KEY,
			async (error, decodedAccessToken: any) => {
				// 4) reject token if invalid or expired
				if (error) {
					if (error.name === "TokenExpiredError") {
						return res.status(401).send({ error_code: "TOKEN EXPIRED" });
					} else {
						res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
						return res.status(401).send({ error_code: "TOKEN INVALID" });
					}
				}

				// eslint-disable-next-line no-unused-vars
				const { exp, iat, ...payload } = decodedAccessToken;

				// 5) set token payload in cache
				await AuthTokenCache.setKey(accessToken, { ...payload }, exp - iat);

				// is this necessary? *** FLAG ***
				// 6) ensure client has refresh token
				if (!req.cookies[REFRESH_TOKEN_COOKIE_NAME]) {
					const tokenStore: any = await TokenStore.findOne({
						access_token: accessToken
					});
					res.cookie(REFRESH_TOKEN_COOKIE_NAME, tokenStore.refresh_token, {
						httpOnly: true,
						expires: tokenStore.refresh_token_exp_date
					});
				}

				const accessTokenPayload: AccessTokenPayload = { ...payload };

				return res.send(accessTokenPayload);
			}
		);
	}
);

// token required
app.get(
	`${API_BASE_URL}${PATHNAME}/refresh`,
	async (req: RequestWithIpInfo, res) => {
		const { token: accessToken } = req;

		if (!accessToken) {
			return res.status(400).send({
				error_code: "MISSING AUTHORIZATION BEARER TOKEN"
			});
		}

		// 1) check if token has been blacklisted, reject and wipe cookie if so
		const isBlacklisted: boolean =
			(await TokenBlacklistCache.getKey(accessToken)) !== null;
		if (isBlacklisted) {
			res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
			return res.status(401).send({ error_code: "TOKEN INVALID" });
		}

		// 2) check for refresh token, reject if missing
		const refreshToken: string = req.cookies[REFRESH_TOKEN_COOKIE_NAME];
		if (!refreshToken) {
			return res.status(401).send({ error_code: "REFRESH TOKEN INVALID" });
		}

		// 3) retrieve tokenstore to check refreshToken matches accessToken, reject if doesn't exit
		const tokenStore: any = await TokenStore.findOne({
			access_token: accessToken,
			refresh_token: refreshToken
		});
		if (tokenStore === null) {
			return res.status(401).send({ error_code: "INVALID TOKEN PAIRING" });
		}

		// 4) pull user based on field in the tokenstore
		const user: User = new User();
		await user.initByID(tokenStore.user_id);

		// 5) generate tokens and issue a sign in response
		user.initUserTokens().then(async ({ accessTokenData, refreshTokenData }) => {
			// 4) save token data to database
			console.log(user.getFields());
			await TokenStore.create({
				user_id: user.getFields()._id,
				access_token: accessTokenData.token,
				refresh_token: refreshTokenData.token,
				access_token_exp_date: accessTokenData.expDate,
				refresh_token_exp_date: refreshTokenData.expDate,
				requester_data: { ...req.useragent, ...req.ipInfo }
			});

			// 5) set access token payload in the cache
			await AuthTokenCache.setKey(
				accessTokenData.token,
				accessTokenData.payload,
				accessTokenData.exp - accessTokenData.iat
			);
			// await cacheAccessToken(accessTokenData);

			// 6) set refresh token in a cookie
			res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshTokenData.token, {
				httpOnly: true,
				expires: refreshTokenData.expDate,
				sameSite: true
			});

			// 7) format and send
			const dataToSend: SignInResponse = {
				access_token: accessTokenData.token,
				...accessTokenData.payload
			};

			res.send(dataToSend);
		});
	}
);

// token required
app.post(`${API_BASE_URL}${PATHNAME}/sign-out`, async (req, res) => {
	const { token: accessToken } = req;

	if (!accessToken) {
		return res.status(400).send({
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	// 1) check if token has already been blacklisted, reject if so
	const isBlacklisted: boolean =
		(await TokenBlacklistCache.getKey(accessToken)) !== null;
	if (isBlacklisted) {
		res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
		return res.status(401).send({ error_code: "TOKEN INVALID" });
	}

	// 2) check for token payload in cache, if there get ttl and set in blacklist for ttl
	const cachedPayload: any = await AuthTokenCache.getKey(accessToken);
	if (cachedPayload !== null) {
		const ttl: number = await AuthTokenCache.getTTL(accessToken);
		await TokenBlacklistCache.setKey(accessToken, {}, ttl);
		return res.send("SUCCESS");
	}

	// 3) if not in cache decode manually, then black list for ttl
	jwt.verify(accessToken, JWT_SECRET_KEY, async (error, decodedToken: any) => {
		if (error) {
			return res.status(400).send({ error_code: "TOKEN INVALID" });
		}
		const { exp, iat }: { exp: number; iat: number } = decodedToken;
		await TokenBlacklistCache.setKey(accessToken, {}, exp - iat);
		return res.send("SUCCESS");
	});
});

// token required
app.post(
	`${API_BASE_URL}${PATHNAME}/sign-out-all-devices`,
	async (req, res) => {
		const { token: accessToken } = req;

		if (!accessToken) {
			return res.status(400).send({
				error_code: "MISSING AUTHORIZATION BEARER TOKEN"
			});
		}

		// 1) check to make sure submitted token has not been invalided.
		const isBlacklisted: boolean =
			(await TokenBlacklistCache.getKey(accessToken)) !== null;
		if (isBlacklisted) {
			res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
			return res.status(401).send({ error_code: "TOKEN INVALID" });
		}

		// 2) check for token in the cache
		const cachedPayload: any = await AuthTokenCache.getKey(accessToken);
		if (cachedPayload !== null) {
			const {
				access_type,
				authenticated_user
			}: {
				access_type: string;
				authenticated_user: { _id: string };
			} = cachedPayload;

			if (access_type === "SYSTEM") {
				await AuthTokenCache.deleteKey(accessToken);
			}
			// pull all tokenstores for user id found in payload
			const stores: any = await TokenStore.find({
				user_id: authenticated_user._id,
				access_token_exp_date: { $gte: new Date() }
			});

			console.log(stores);

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
			return res.send("SUCCESS");
		}

		// 3) if not in cache decode manually
		jwt.verify(accessToken, JWT_SECRET_KEY, async (error, decodedToken: any) => {
			// 4) reject token if invalid or expired
			if (error) {
				if (error.name === "TokenExpiredError") {
					return res.status(401).send({ error_code: "TOKEN EXPIRED" });
				} else {
					res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
					return res.status(401).send({ error_code: "TOKEN INVALID" });
				}
			}
			const {
				authenticated_user
			}: { authenticated_user: { _id: string } } = decodedToken;

			// 5)  pull all tokenstores for user id found in payload
			const stores: any = await TokenStore.find({
				user_id: authenticated_user._id,
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

			return res.send("SUCCESS");
		});
	}
);

const dbOptions: ConnectionOptions = {
	useNewUrlParser: true,
	useUnifiedTopology: true
};

mongoose.connect(
	`${MONGO_DB_URL}/authentication-api?retryWrites=true&w=majority`,
	dbOptions,
	(error) => {
		if (error) {
			console.trace(error);
			process.exit(1);
		}

		app.listen(PORT, () => {
			console.log(`Authentication API running on PORT ${PORT}!`);
		});
	}
);
