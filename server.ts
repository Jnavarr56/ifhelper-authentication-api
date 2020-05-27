import express, { Application, response } from "express";
import RedisCacheManager from "./utils/RedisCacheManager";
import User from "./utils/User";
import {
	SignInResponse,
	AccessTokenPayload,
	UpdateUserFields,
	UserRecord,
	NewUserFields
} from "./types/index";
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
import { validateRefreshTokenCookie } from "./utils/cookie";
import { blacklistAllTokens } from "./utils/tokens";
import { google, oauth2_v2 } from "googleapis";
import {
	GetTokenResponse,
	OAuth2Client
} from "google-auth-library/build/src/auth/oauth2client";
import { Credentials } from "google-auth-library/build/src/auth/credentials";
import { GaxiosResponse } from "gaxios";

require("dotenv").config();

const {
	PORT = 3000,
	REDIS_PORT,
	REDIS_URL,
	MONGO_DB_URL,
	JWT_SECRET_KEY,
	GOOGLE_OAUTH_CLIENT_ID,
	GOOGLE_OAUTH_SECRET,
	GOOGLE_OAUTH_REDIRECT_URL,
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

const oauth2Client: OAuth2Client = new google.auth.OAuth2(
	GOOGLE_OAUTH_CLIENT_ID,
	GOOGLE_OAUTH_SECRET,
	GOOGLE_OAUTH_REDIRECT_URL
);

// public
app.get(`${API_BASE_URL}${PATHNAME}/sign-in/google`, async (req, res) => {
	// 1) generate oauth screen url
	const consent_screen_url: string = oauth2Client.generateAuthUrl({
		scope: [
			"https://www.googleapis.com/auth/plus.login",
			"https://www.googleapis.com/auth/userinfo.profile",
			"https://www.googleapis.com/auth/userinfo.email"
		]
	});
	// 2) send oauth screen url
	res.send({ consent_screen_url });
});

app.get(
	`${API_BASE_URL}${PATHNAME}/callback/google`,
	async (req: RequestWithIpInfo, res) => {
		// 1) grab authorization code from query params, reject if missing
		const code: string | any = req.query.code;
		if (!code)
			return res.status(400).send({ error_code: "MISSING AUTHORIZATION CODE" });

		// 2) exchange code for tokens, send error if there is a problem
		let tokens: Credentials;
		try {
			tokens = await oauth2Client
				.getToken(code)
				.then(({ tokens }): Credentials => tokens);
		} catch (error) {
			const response: GaxiosResponse = error.response;
			const { data, status } = response;
			res.status(status).send(data);
		}

		// 3) use tokens to initialize a client that can be used to get the users profile
		const auth: OAuth2Client = new google.auth.OAuth2();
		auth.setCredentials(tokens);
		const profileClient: oauth2_v2.Oauth2 = google.oauth2({
			auth,
			version: "v2"
		});

		// 4) get users profile using client
		const userProfile: oauth2_v2.Schema$Userinfo = await profileClient.userinfo.v2.me
			.get()
			.then(({ data }): oauth2_v2.Schema$Userinfo => data);

		// 5) attempt to locate user with this gmail if can't, try to locate by user google profile id
		const { email, id: google_id } = userProfile;

		const user = new User();
		await user.initByEmail(email).then(async () => {
			if (!user.exists()) await user.initByGoogleID(google_id);
		});

		// 6) if found user make sure fields are current
		if (user.exists()) {
			const updateFields: UpdateUserFields = {};
			const userFields: UserRecord = user.getFields();

			if (userFields.google_id !== google_id) updateFields.google_id = google_id;
			if (userFields.email !== email) updateFields.email = email;
			if (!userFields.email_confirmed) updateFields.email_confirmed = true;

			if (Object.keys(updateFields).length > 0) await user.update(updateFields);

			// 6) if did not find user, create user
		} else {
			const { given_name: first_name, family_name: last_name } = userProfile;

			await user.create({
				google_id,
				email,
				first_name,
				last_name,
				password: google_id,
				email_confirmed: true
			});
		}

		// 7) produce tokens for user
		const { accessTokenData } = user.initUserTokens();
		// 8) save token data to database
		await user.storeUserTokens(req);
		// 9) set access token payload in the cache
		await user.cacheUserTokens();
		// 10) set refresh token in a cookie
		user.setUserRefreshTokenCookie(res);
		// 11) format and send
		const dataToSend: SignInResponse = {
			access_token: accessTokenData.token,
			...accessTokenData.payload
		};
		res.send(dataToSend);
	}
);

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
		const { accessTokenData } = user.initUserTokens();
		// 4) save token data to database
		await user.storeUserTokens(req);
		// 5) set access token payload in the cache
		await user.cacheUserTokens();
		// 6) set refresh token in a cookie
		user.setUserRefreshTokenCookie(res);
		// 7) format and send
		const dataToSend: SignInResponse = {
			access_token: accessTokenData.token,
			...accessTokenData.payload
		};
		res.send(dataToSend);
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
				await AuthTokenCache.deleteKey(accessToken);
			} else {
				await validateRefreshTokenCookie(req, res, accessToken);
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
				// 6) ensure client has refresh token
				await validateRefreshTokenCookie(req, res, accessToken);
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

		// 5) produce tokens for user
		const { accessTokenData } = user.initUserTokens();
		// 6) save token data to database
		await user.storeUserTokens(req);
		// 7) set access token payload in the cache
		await user.cacheUserTokens();
		// 8) set refresh token in a cookie
		user.setUserRefreshTokenCookie(res);
		// 9) format and send
		const dataToSend: SignInResponse = {
			access_token: accessTokenData.token,
			...accessTokenData.payload
		};
		res.send(dataToSend);
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

			// 3) pull all tokenstores for user and add the tokens in them to blacklist cache
			await blacklistAllTokens(authenticated_user._id);

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
			await blacklistAllTokens(authenticated_user._id);
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
