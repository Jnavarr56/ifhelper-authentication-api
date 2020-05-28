import jwt from "jsonwebtoken";
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
require("dotenv").config();

const { JWT_SECRET_KEY } = process.env;

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
