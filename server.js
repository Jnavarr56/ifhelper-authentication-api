const morgan = require("morgan");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const expressip = require("express-ip");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const useragent = require("express-useragent");
const bearerToken = require("express-bearer-token");

const { TokenStore } = require("./db/models");
const RedisCacheManager = require("./utils/RedisCacheManager");
const { generateUserTokens } = require("./utils/tokens");
const { validateRefreshTokenCookie } = require("./utils/cookie");
const {
	fetchUserByEmail,
	fetchUserById,
	verifyUserPassword
} = require("./utils/user");

require("dotenv").config();

const PORT = process.env.PORT || 3000;
const REDIS_PORT = process.env.REDIS_PORT || 6379;

const { REFRESH_TOKEN_COOKIE_NAME, JWT_SECRET_KEY } = process.env;

const MONGO_DB_URL = "mongodb://127.0.0.1:27017";

const tokenCache = new RedisCacheManager({
	port: REDIS_PORT,
	prefix: "AUTHENTICATION_TOKENS"
});

const tokenBlacklistCache = new RedisCacheManager({
	port: REDIS_PORT,
	prefix: "AUTHENTICATION_TOKENS_BLACKLIST"
});

const app = express();

app
	.use(bodyParser.urlencoded({ extended: true }))
	.use(bodyParser.json())
	.use(useragent.express())
	.use(expressip().getIpInfoMiddleware)
	.use(bearerToken())
	.use(cookieParser())
	.use(morgan("dev"));

// public
app.post("/sign-in", async (req, res) => {
	const { email, password } = req.body;

	// If email or password not supplied send bad 400 back error.
	if (!email || !password) {
		return res.status(400).send({ error_code: "MISSING EMAIL OR PASSWORD" });
	}

	// Fetch user by submitted email. If user does not exist return 401 error.
	const { user, error: userFetchError } = await fetchUserByEmail(
		email,
		tokenCache
	);

	if (userFetchError) {
		const { data: error, status, error_code } = userFetchError;
		console.trace(error_code, error);
		return res.status(status).send({ error_code, error });
	} else if (user === null) {
		return res.status(401).send({
			error_code: "EMAIL/PASSWORD COMBINATION NOT RECOGNIZED"
		});
	}

	// Check submitted password against hased password in DB.
	// If not a match, send back 401 error.
	const passwordIsValid = verifyUserPassword(password, user.password);
	if (!passwordIsValid) {
		return res.status(401).send({
			error_code: "EMAIL/PASSWORD COMBINATION NOT RECOGNIZED"
		});
	}

	// Create auth tokens for user.
	// These are objects filled with the data
	//  relevant to each token including the token iteself.
	const { accessToken, refreshToken } = generateUserTokens(user, {
		accessTokenExpiresIn: 60 * 60, // 1 Hour
		refreshTokenExpiresIn: 60 * 60 * 24 * 7 // 1 Week
	});

	// Save token/sign-in data to db for record keeping
	// puropses. Send 500 error if there is a problem.
	try {
		await TokenStore.create({
			user_id: user._id,
			access_token: accessToken.token,
			refresh_token: refreshToken.token,
			access_token_exp_date: accessToken.expDate,
			refresh_token_exp_date: refreshToken.expDate,
			requester_data: { ...req.useragent, ...req.ipInfo }
		});
	} catch (error) {
		const error_code = "PROBLEM STORING CREDENTIALS";
		console.trace(error_code, error);
		return res.status(500).send({ error_code });
	}

	// Cache accessToken data for its life span of token.
	// Use the accessToken as the key and its payload
	// and exp/iat data as the value. Return 500 error if
	// there is a problem.
	/* (accessToken.payload)
		{
			"access_type": "USER",
			"authenticated_user": {
				"access_level": (user.access_level),
				"_id": (user._id)
			}
		}
	*/
	const { status, cacheError } = await tokenCache.setKey(
		accessToken.token,
		{
			...accessToken.payload,
			exp: accessToken.exp,
			iat: accessToken.iat
		},
		accessToken.exp - accessToken.iat
	);

	if (status !== "OK" || cacheError) {
		const error_code = "PROBLEM STORING CREDENTIALS";
		console.trace(error_code, cacheError);
		return res.status(500).send({ error_code });
	}

	// Set refresh token in httpOnly cookie for its lifespan.
	res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken.token, {
		httpOnly: true,
		expires: refreshToken.expDate
	});

	// Set send back access token and payload.
	/*
		{
			"access_token": (token),
			"access_type": "USER",
			"authenticated_user": {
				"access_level": (user.access_level),
				"_id": (user._id)
			}
		}
	*/
	return res.send({
		access_token: accessToken.token,
		...accessToken.payload
	});
});

// token required, sys(1 time ok, does not set refresh token in cache) vs user
app.get("/authorize", async (req, res) => {
	const { token: access_token } = req;

	// Check for access_token in header. If missing,
	// send back 400 error.
	if (!access_token) {
		return res.status(400).send({
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	const {
		cacheError: blacklistCacheError,
		cachedVal: blacklistCachedVal
	} = await tokenBlacklistCache.getKey(access_token);

	if (blacklistCacheError) {
		const error_code = "PROBLEM CHECKING BLACKLIST CACHE";
		console.trace(error_code, blacklistCacheError);
		return res.status(500).send({ error_code });
	} else if (blacklistCachedVal) {
		res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
		return res.status(401).send({
			error_code: "TOKEN INVALID"
		});
	}

	// Check if access_token is in the cache as a key.
	// If it is not cachedVal will be null.
	// The following would be the value if true:
	/*
		{
			"access_type": "USER",
			"authenticated_user": {
				"access_level": (user.access_level),
				"_id": (user._id)
			}
		}
	*/
	// Send 500 error if there is a problem.
	const { cacheError, cachedVal } = await tokenCache.getKey(access_token);

	if (cachedVal) {
		if (cachedVal.access_type === "SYSTEM") {
			tokenCache.deleteKey(access_token);
		} else {
			const { error: resetRefreshTokenError } = await validateRefreshTokenCookie(
				req,
				res,
				access_token
			);
			if (resetRefreshTokenError) {
				const { error, status, code } = resetRefreshTokenError;
				console.trace(code, error);
				return res.status(status).send({ error_code: code });
			}
		}

		// eslint-disable-next-line no-unused-vars
		const { exp, iat, ...rest } = cachedVal;
		return res.send({ ...rest });
	} else if (cacheError) {
		// If there was a problem reading the cache
		// then send back a 500 error.
		const error_code = "PROBLEM READING CACHE";
		console.trace(cacheError, error_code);
		return res.status(500).send({ error_code });
	}

	// Since token is not in cache, verify token directly.
	jwt.verify(access_token, JWT_SECRET_KEY, async (error, decodedAccessToken) => {
		if (error) {
			const { name } = error;
			let error_code;
			if (name === "TokenExpiredError") {
				error_code = "TOKEN EXPIRED";
			} else {
				// Wipe refresh token cookie if token is invalid.
				error_code = "TOKEN INVALID";
				res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
			}

			return res.status(401).send({ error_code });
		}

		// Validate refresh token if needed;
		const { error: resetRefreshTokenError } = await validateRefreshTokenCookie(
			req,
			res,
			access_token
		);

		if (resetRefreshTokenError) {
			const { error, status, code } = resetRefreshTokenError;
			console.trace(code, error);
			return res.status(status).send({ error_code: code });
		}

		//Set decoded token in cache.
		const { status, cacheError } = await tokenCache.setKey(
			access_token,
			decodedAccessToken,
			decodedAccessToken.exp - decodedAccessToken.iat
		);

		if (status !== "OK" || cacheError) {
			const error_code = "PROBLEM STORING CREDENTIALS";
			console.trace(error_code, error);
			return res.status(500).send({ error_code });
		}

		// eslint-disable-next-line no-unused-vars
		const { exp, iat, ...accessTokenPayload } = decodedAccessToken;
		return res.send({ ...accessTokenPayload });
	});
});

// token required, user
app.get("/refresh", async (req, res) => {
	// Check for access_token in header. If missing,
	// send back 400 error.
	const { token: access_token } = req;
	if (!access_token) {
		return res.status(400).send({
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	const {
		cacheError: blacklistCacheError,
		cachedVal: blacklistCachedVal
	} = await tokenBlacklistCache.getKey(access_token);

	if (blacklistCacheError) {
		const error_code = "PROBLEM CHECKING BLACKLIST CACHE";
		console.trace(error_code, blacklistCacheError);
		return res.status(500).send({ error_code });
	} else if (blacklistCachedVal) {
		res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
		return res.status(401).send({
			error_code: "TOKEN INVALID"
		});
	}

	// Check for refresh_token in cookie. If missing,
	// send back 401 error.
	const refresh_token = req.cookies[REFRESH_TOKEN_COOKIE_NAME];
	if (!refresh_token) {
		return res.status(401).send({
			error_code: "REFRESH TOKEN INVALID"
		});
	}

	let tokenStore;

	// Pull relevant TokenStore record based on access_token and refresh_token
	// to verify pairing.
	try {
		tokenStore = await TokenStore.findOne({ access_token, refresh_token });

		if (tokenStore === null) {
			const error_code = "NO RECORD OF CURRENT TOKEN PAIRING EXISTS";
			console.trace(error_code);
			res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
			return res.status(401).send({ error_code });
		}
	} catch (error) {
		const error_code = "PROBLEM RETRIEVING TOKEN RECORD";
		console.trace(error, error_code);
		return res.status(500).send({ error_code });
	}

	// Take tokenStore and use tokenStore.user_id to pull user record.
	const { user_id } = tokenStore;
	const { user, error: userFetchError } = await fetchUserById(
		user_id,
		tokenCache
	);

	// If user does not exist return an error.
	if (userFetchError) {
		const { data, status, error_code } = userFetchError;
		console.trace(error_code, data);
		return res.status(status).send({ error_code });
	}

	// Generate new tokens for the user.
	const { accessToken, refreshToken } = generateUserTokens(user, {
		accessTokenExpiresIn: 60 * 60, // 1 Hour
		refreshTokenExpiresIn: 60 * 60 * 24 * 7 // 1 Week
	});

	// Save token/sign-in data to db for record keeping
	// puropses. Send 500 error if there is a problem.
	try {
		await TokenStore.create({
			user_id: user._id,
			access_token: accessToken.token,
			refresh_token: refreshToken.token,
			access_token_exp_date: accessToken.expDate,
			refresh_token_exp_date: refreshToken.expDate,
			requester_data: { ...req.useragent, ...req.ipInfo }
		});
	} catch (error) {
		const error_code = "PROBLEM STORING CREDENTIALS";

		console.trace(error_code, error);
		return res.status(500).send({ error_code });
	}

	// Cache accessToken data for its life span of token.
	// Use the accessToken as the key and its payload
	// and exp/iat data as the value. Return 500 error if
	// there is a problem.
	/* (accessToken.payload)
		{
			"access_type": "USER",
			"authenticated_user": {
				"access_level": (user.access_level),
				"_id": (user._id)
			}
		}
	*/
	const { status, cacheError } = await tokenCache.setKey(
		accessToken.token,
		{
			...accessToken.payload,
			exp: accessToken.exp,
			iat: accessToken.iat
		},
		accessToken.exp - accessToken.iat
	);

	if (status !== "OK" || cacheError) {
		const error_code = "PROBLEM STORING CREDENTIALS";
		console.trace(error_code, cacheError);
		return res.status(500).send({ error_code });
	}

	// Set refresh token in httpOnly cookie for its lifespan.
	res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken.token, {
		httpOnly: true,
		expires: refreshToken.expDate
	});

	return res.send({
		access_token: accessToken.token,
		...accessToken.payload
	});
});

// token required, user
app.post("/sign-out", async (req, res) => {
	const { token: access_token } = req;

	// Check for access_token in header. If missing,
	// send back 400 error.
	if (!access_token) {
		return res.status(400).send({
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	const {
		cacheError: blacklistCacheError,
		cachedVal: blacklistCachedVal
	} = await tokenBlacklistCache.getKey(access_token);

	if (blacklistCacheError) {
		console.trace("PROBLEM CHECKING BLACKLIST CACHE");
	}

	if (blacklistCachedVal) {
		return res.status(401).send({
			error_code: "TOKEN ALREADY BLACKLISTED"
		});
	}

	const {
		cacheError: tokenCacheError,
		cachedVal: tokenCachedVal
	} = await tokenCache.getKey(access_token);

	if (tokenCacheError) {
		console.trace("PROBLEM CHECKING TOKEN CACHE");
	}

	if (tokenCachedVal) {
		const { exp, iat } = tokenCachedVal;
		const { status, cacheError } = await tokenBlacklistCache.setKey(
			access_token,
			{ created_at: new Date() },
			exp - iat
		);

		if (status !== "OK" || cacheError) {
			const error_code = "PROBLEM BLACKLISTING TOKEN";
			console.log(error_code, cacheError);
			return res.send(500)({ error_code });
		}

		return res.send("SUCCESS");
	}

	jwt.verify(access_token, JWT_SECRET_KEY, async (error, decodedToken) => {
		if (error) {
			return res.status(400).send({
				error_code: "TOKEN ALREADY INVALID"
			});
		}

		const { exp, iat } = decodedToken;

		const { status, cacheError } = await tokenBlacklistCache.setKey(
			access_token,
			{ created_at: new Date() },
			exp - iat
		);

		if (status !== "OK" || cacheError) {
			const error_code = "PROBLEM BLACKLISTING TOKEN";
			console.log(error_code, cacheError);
			return res.send(500)({ error_code });
		}

		return res.send("SUCCESS");
	});
});

// token required, user and sys same
app.post("/sign-out-all-devices", async (req, res) => {
	const { token: access_token } = req;

	// Check for access_token in header. If missing,
	// send back 400 error.
	if (!access_token) {
		return res.status(400).send({
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	// Check to make sure submitted token has not been invalided.
	const {
		cacheError: blacklistCacheError,
		cachedVal: blacklistCachedVal
	} = await tokenBlacklistCache.getKey(access_token);

	if (blacklistCacheError) {
		console.trace("PROBLEM CHECKING BLACKLIST CACHE");
	}

	if (blacklistCachedVal) {
		return res.status(401).send({
			error_code: "TOKEN ALREADY BLACKLISTED"
		});
	}

	// Check for token in the tokenCache.
	const {
		cacheError: tokenCacheError,
		cachedVal: tokenCachedVal
	} = await tokenCache.getKey(access_token);

	if (tokenCacheError) {
		const error_code = "PROBLEM READING CACHE";
		console.trace(tokenCacheError, error_code);
		return res.status(500).send({ error_code });
	} else if (tokenCachedVal) {
		const { access_type, authenticated_user } = tokenCachedVal;

		if (access_type === "SYSTEM") {
			tokenCache.deleteKey(access_token);
		}

		try {
			const stores = await TokenStore.find({
				user_id: authenticated_user._id,
				access_token_exp_date: {
					$gte: new Date()
				}
			});

			for (let tokenStore of stores) {
				const { cachedVal, cacheError } = await tokenBlacklistCache.getKey(
					tokenStore.access_token
				);
				if (cacheError) throw new Error(cacheError);

				if (!cachedVal) {
					const { cacheError } = await tokenBlacklistCache.setKey(
						tokenStore.access_token,
						{ created_at: new Date() },
						Math.ceil(
							(tokenStore.access_token_exp_date - tokenStore.createdAt) / 1000
						)
					);
					if (cacheError) throw new Error(cacheError);
				}
			}

			return res.send("SUCCESS");
		} catch (error) {
			const error_code = "PROBLEM BLACKLISTING TOKENS";
			console.trace(error, error_code);
			return res.status(500).send({ error_code });
		}
	} else {
		jwt.verify(access_token, JWT_SECRET_KEY, async (error, decodedToken) => {
			if (error) {
				return res.status(401).send({
					error_code: "TOKEN ALREADY INVALID"
				});
			}

			const { authenticated_user } = decodedToken;

			try {
				const stores = await TokenStore.find({
					user_id: authenticated_user._id,
					access_token_exp_date: {
						$gte: new Date()
					}
				});

				console.log(stores, "non cache sys: false");

				for (let tokenStore of stores) {
					const { cachedVal, cacheError } = await tokenBlacklistCache.getKey(
						tokenStore.access_token
					);
					if (cacheError) throw new Error(cacheError);
					if (!cachedVal) {
						const { cacheError } = await tokenBlacklistCache.setKey(
							tokenStore.access_token,
							{ created_at: new Date() },
							Math.ceil(
								(tokenStore.access_token_exp_date - tokenStore.createdAt) / 1000
							)
						);
						if (cacheError) throw new Error(cacheError);
					}
				}
			} catch (error) {
				const error_code = "PROBLEM BLACKLISTING TOKENS";
				console.trace(error, error_code);
				return res.status(500).send({ error_code });
			}

			return res.send("SUCCESS");
		});
	}
});

const dbOptions = {
	useNewUrlParser: true,
	useUnifiedTopology: true
};

mongoose.connect(`${MONGO_DB_URL}/authentication-api`, dbOptions, (error) => {
	if (error) {
		console.log(error);
		process.exit(1);
	}

	app.listen(PORT, () => {
		console.log(`Authentication API running on PORT ${PORT}!`);
	});
});
