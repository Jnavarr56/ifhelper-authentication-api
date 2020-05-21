const jwt = require("jsonwebtoken");
const cryptoRandomString = require("crypto-random-string");

require("dotenv").config();

const { JWT_SECRET_KEY } = process.env;

const generateSystemAuthToken = async (tokenCacheManager) => {
	const sysAuthToken =
		"SYS" + cryptoRandomString({ length: 10, type: "base64" });
	const payload = { access_type: "SYSTEM" };

	const { cacheError, status } = await tokenCacheManager.setKey(
		sysAuthToken,
		payload,
		60 * 60
	);

	if (cacheError || status !== "OK") {
		console.trace(cacheError, status);
		throw new Error(cacheError);
	}

	return sysAuthToken;
};

const generateUserTokens = (user, options) => {
	// Produce tokens from user record.

	const { access_level, _id } = user;
	const {
		// Default to 1 Hour.
		accessTokenExpiresIn = 60 * 60,
		// Default to 1 Week.
		refreshTokenExpiresIn = 60 * 60 * 24 * 7
	} = options;

	const accessTokenPayload = {
		access_type: "USER",
		authenticated_user: { access_level, _id }
	};

	const accessToken = jwt.sign(accessTokenPayload, JWT_SECRET_KEY, {
		expiresIn: accessTokenExpiresIn
	});

	const refreshTokenPayload = { _id };

	const refreshToken = jwt.sign(refreshTokenPayload, JWT_SECRET_KEY, {
		expiresIn: refreshTokenExpiresIn
	});

	const accessTokenDecoded = jwt.verify(accessToken, JWT_SECRET_KEY);
	const refreshTokenDecoded = jwt.verify(refreshToken, JWT_SECRET_KEY);

	return {
		accessToken: {
			token: accessToken,
			payload: accessTokenPayload,
			exp: accessTokenDecoded.exp,
			expDate: new Date(accessTokenDecoded.exp * 1000),
			iat: accessTokenDecoded.iat
		},
		refreshToken: {
			token: refreshToken,
			payload: refreshTokenPayload,
			exp: refreshTokenDecoded.exp,
			expDate: new Date(refreshTokenDecoded.exp * 1000),
			iat: refreshTokenDecoded.iat
		}
	};
};

module.exports = { generateSystemAuthToken, generateUserTokens };
