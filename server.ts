import express, { Application } from "express";
import {
	AuthTokenCacheManager,
	TokenBlacklistCacheManager
} from "./utils/RedisCacheManager";
import User from "./utils/User";
import {
	SignInResponse,
	UpdateUserFields,
	UserRecord,
	AuthorizationResponse,
	CachedPayload,
	DecodedPayload,
	AccessTokenData,
	TokenDataPair
} from "./types/index";
import useragent from "express-useragent";
import bodyParser from "body-parser";
import bearerToken from "express-bearer-token";
import expressip from "express-ip";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import cors, { CorsOptions } from "cors";
import { TokenStore } from "./db/models";
import mongoose, { ConnectionOptions } from "mongoose";
import jwt, { TokenExpiredError, JsonWebTokenError } from "jsonwebtoken";
import { RequestWithIpInfo } from "./types/index";
import { validateRefreshTokenCookie } from "./utils/cookie";
import { google, oauth2_v2 } from "googleapis";
import { OAuth2Client } from "google-auth-library/build/src/auth/oauth2client";
import { Credentials } from "google-auth-library/build/src/auth/credentials";
import { GaxiosResponse } from "gaxios";
import { PORT, PATHNAME, REFRESH_TOKEN_COOKIE_NAME } from "./vars";

require("dotenv").config();

const {
	MONGO_DB_URL,
	JWT_SECRET_KEY,
	GOOGLE_OAUTH_SECRET,
	GOOGLE_OAUTH_CLIENT_ID,
	GOOGLE_OAUTH_REDIRECT_URL
} = process.env;

const app: Application = express();

const corsOpts: CorsOptions = {
	credentials: true,
	origin: "http://localhost:3000",
	allowedHeaders: [
		"Access-Control-Allow-Credentials",
		"Authorization",
		"Content-Type"
	]
};

app
	.use(bodyParser.json())
	.use(bodyParser.urlencoded({ extended: true }))
	.use(useragent.express())
	.use(expressip().getIpInfoMiddleware)
	.use(bearerToken())
	.use(cookieParser())
	.use(morgan("dev"))
	.use(cors(corsOpts));

app.options("*", cors(corsOpts));

const AuthTokenCache: AuthTokenCacheManager = new AuthTokenCacheManager();
const TokenBlacklistCache: TokenBlacklistCacheManager = new TokenBlacklistCacheManager();

// user inactivation check?
// model types
// cache types

const oauth2Client: OAuth2Client = new google.auth.OAuth2(
	GOOGLE_OAUTH_CLIENT_ID,
	GOOGLE_OAUTH_SECRET,
	GOOGLE_OAUTH_REDIRECT_URL
);

// public
app.get(`${PATHNAME}/sign-in/google`, async (req, res) => {
	const consent_screen_url: string = oauth2Client.generateAuthUrl({
		scope: [
			"https://www.googleapis.com/auth/plus.login",
			"https://www.googleapis.com/auth/userinfo.profile",
			"https://www.googleapis.com/auth/userinfo.email"
		]
	});
	res.send({ consent_screen_url });
});

app.get(`${PATHNAME}/callback/google`, async (req: RequestWithIpInfo, res) => {
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

		if (userFields.email !== email) updateFields.email = email;
		if (!userFields.email_confirmed) updateFields.email_confirmed = true;

		if (userFields.google_id !== google_id) updateFields.google_id = google_id;

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

	const tokenData: TokenDataPair = user.initUserTokens();
	const accessTokenData: AccessTokenData = tokenData.accessTokenData;
	await user.storeUserTokens(req);
	await user.cacheUserTokens();
	user.setUserRefreshTokenCookie(res);

	const signInData: SignInResponse = {
		access_token: accessTokenData.token,
		...accessTokenData.payload
	};
	res.send(signInData);
});

// public
app.post(`${PATHNAME}/sign-in`, async (req: RequestWithIpInfo, res) => {
	const email: string = req.body.email;
	const password: string = req.body.password;

	if (!email || !password) {
		return res.status(400).send({ error_code: "MISSING EMAIL OR PASSWORD" });
	}

	const user: User = new User();
	await user.initByEmail(email);

	if (!user.exists() || !user.hasPassword(password)) {
		return res.status(401).send({
			error_code: "EMAIL/PASSWORD COMBINATION NOT RECOGNIZED"
		});
	} else if (!user.confirmedEmail()) {
		return res.status(401).send({
			error_code: "EMAIL NOT CONFIRMED"
		});
	}

	const tokenData: TokenDataPair = user.initUserTokens();
	const accessTokenData: AccessTokenData = tokenData.accessTokenData;
	await user.storeUserTokens(req);
	await user.cacheUserTokens();
	user.setUserRefreshTokenCookie(res);

	const signInData: SignInResponse = {
		access_token: accessTokenData.token,
		...accessTokenData.payload
	};
	res.send(signInData);
});

// token required
app.get(`${PATHNAME}/authorize`, async (req: RequestWithIpInfo, res) => {
	const accessToken: string = req.token;
	if (!accessToken) {
		return res.status(400).send({
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	if (await TokenBlacklistCache.isBlacklisted(accessToken)) {
		res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
		return res.status(401).send({ error_code: "TOKEN INVALID" });
	}

	const cachedPayload: AuthorizationResponse = await AuthTokenCache.getCachedPayload(
		accessToken
	);
	if (cachedPayload !== null) {
		if (cachedPayload.access_type === "USER") {
			await validateRefreshTokenCookie(req, res, accessToken);
		}
		return res.send(cachedPayload);
	}

	jwt.verify(
		accessToken,
		JWT_SECRET_KEY,
		async (
			error: TokenExpiredError | JsonWebTokenError,
			decodedPayload: DecodedPayload
		) => {
			if (error) {
				if (error instanceof TokenExpiredError) {
					return res.status(401).send({ error_code: "TOKEN EXPIRED" });
				} else {
					res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
					return res.status(401).send({ error_code: "TOKEN INVALID" });
				}
			}

			const { exp, iat, ...payload } = decodedPayload;
			const cacheTTL: number = exp - iat;
			const accessTokenPayload: AuthorizationResponse = { ...payload };

			await AuthTokenCache.cacheToken(accessToken, accessTokenPayload, cacheTTL);
			await validateRefreshTokenCookie(req, res, accessToken);

			return res.send(accessTokenPayload);
		}
	);
});

// VERIFY TOKENS
app.get(`${PATHNAME}/refresh`, async (req: RequestWithIpInfo, res) => {
	const accessToken: string = req.token;
	const refreshToken: string = req.cookies[REFRESH_TOKEN_COOKIE_NAME];

	if (!accessToken) {
		return res.status(400).send({
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	} else if (!refreshToken) {
		return res.status(401).send({
			error_code: "REFRESH TOKEN INVALID"
		});
	}

	const isBlacklisted: boolean = await TokenBlacklistCache.isBlacklisted(
		accessToken
	);
	if (isBlacklisted) {
		res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
		return res.status(401).send({ error_code: "TOKEN INVALID" });
	}

	const tokenStore: any = await TokenStore.findOne({
		access_token: accessToken,
		refresh_token: refreshToken
	});
	if (tokenStore === null) {
		return res.status(401).send({ error_code: "INVALID TOKEN PAIRING" });
	}

	try {
		jwt.verify(accessToken, JWT_SECRET_KEY);
		jwt.verify(refreshToken, JWT_SECRET_KEY);
	} catch (error) {
		if (error.name !== "TokenExpiredError") {
			return res.status(401).send({
				error_code: "TOKEN INVALID"
			});
		}
	}

	const user = new User();
	await user.initByID(tokenStore.user_id);

	const tokenData: TokenDataPair = user.initUserTokens();
	const accessTokenData: AccessTokenData = tokenData.accessTokenData;
	await user.storeUserTokens(req);
	await user.cacheUserTokens();
	user.setUserRefreshTokenCookie(res);

	const signInData: SignInResponse = {
		access_token: accessTokenData.token,
		...accessTokenData.payload
	};

	res.send(signInData);
});

// token required
app.post(`${PATHNAME}/sign-out`, async (req, res) => {
	const accessToken: string = req.token;

	if (!accessToken) {
		return res.status(400).send({
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	const isBlacklisted: boolean = await TokenBlacklistCache.isBlacklisted(
		accessToken
	);
	if (isBlacklisted) {
		res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
		return res.status(401).send({ error_code: "TOKEN INVALID" });
	}

	const cachedPayload: CachedPayload = await AuthTokenCache.getCachedPayload(
		accessToken
	);
	if (cachedPayload !== null) {
		const currentTTL: number = await AuthTokenCache.getTTL(accessToken);
		await TokenBlacklistCache.blacklistToken(accessToken, currentTTL);
		return res.send("SUCCESS");
	}

	jwt.verify(
		accessToken,
		JWT_SECRET_KEY,
		async (error, decodedToken: DecodedPayload) => {
			if (error) return res.status(400).send({ error_code: "TOKEN INVALID" });

			const { exp, iat } = decodedToken;
			const currentTTL: number = exp - iat;
			await TokenBlacklistCache.blacklistToken(accessToken, currentTTL);
			return res.send("SUCCESS");
		}
	);
});

// token required
app.post(`${PATHNAME}/sign-out-all-devices`, async (req, res) => {
	const accessToken: string = req.token;

	if (!accessToken) {
		return res.status(400).send({
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	const isBlacklisted: boolean = await TokenBlacklistCache.isBlacklisted(
		accessToken
	);
	if (isBlacklisted) {
		res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
		return res.status(401).send({ error_code: "TOKEN INVALID" });
	}

	const cachedPayload: CachedPayload = await AuthTokenCache.getCachedPayload(
		accessToken
	);
	if (cachedPayload !== null) {
		await TokenBlacklistCache.blacklistAllUserTokens(
			cachedPayload.authenticated_user._id
		);
		return res.send("SUCCESS");
	}

	jwt.verify(
		accessToken,
		JWT_SECRET_KEY,
		async (
			error: TokenExpiredError | JsonWebTokenError,
			decodedPayload: DecodedPayload
		) => {
			if (error) {
				if (error instanceof TokenExpiredError) {
					return res.status(401).send({ error_code: "TOKEN EXPIRED" });
				} else {
					res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
					return res.status(401).send({ error_code: "TOKEN INVALID" });
				}
			}

			await TokenBlacklistCache.blacklistAllUserTokens(
				decodedPayload.authenticated_user._id
			);
			return res.send("SUCCESS");
		}
	);
});

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
