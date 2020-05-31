import {
	AccessTokenData,
	AccessTokenPayload,
	DecodedAccessTokenPayload,
	RefreshTokenPayload,
	DecodedRefreshTokenPayload,
	RefreshTokenData,
	TokenDataPair
} from '../types/Token';
import jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
import { UserRecord } from '../types/User';
import { ACCESS_TOKEN_LIFE_SECS, REFRESH_TOKEN_LIFE_SECS } from '../vars';
dotenv.config();

const JWT_SECRET_KEY: string | undefined = process.env.JWT_SECRET_KEY;

export function createAccessTokenData(
	payload: AccessTokenPayload,
	expiresIn: number
): AccessTokenData {
	if (!JWT_SECRET_KEY) throw new Error('No JWT Secret Key in Environment');

	const token: string = jwt.sign(payload, JWT_SECRET_KEY, { expiresIn });
	const tokenDecoded: any = jwt.verify(token, JWT_SECRET_KEY);

	const decodedPayload: DecodedAccessTokenPayload = tokenDecoded;
	const exp: number = decodedPayload.exp;
	const iat: number = decodedPayload.iat;
	const expDate: Date = new Date(exp * 1000);

	const tokenData: AccessTokenData = {
		token,
		payload,
		exp,
		iat,
		expDate
	};

	return tokenData;
}

export function createRefreshTokenData(
	payload: RefreshTokenPayload,
	expiresIn: number
): RefreshTokenData {
	if (!JWT_SECRET_KEY) throw new Error('No JWT Secret Key in Environment');

	const token: string = jwt.sign(payload, JWT_SECRET_KEY, { expiresIn });
	const tokenDecoded: any = jwt.verify(token, JWT_SECRET_KEY);

	const decodedPayload: DecodedRefreshTokenPayload = tokenDecoded;
	const exp: number = decodedPayload.exp;
	const iat: number = decodedPayload.iat;
	const expDate: Date = new Date(exp * 1000);

	const tokenData: RefreshTokenData = {
		token,
		payload,
		exp,
		iat,
		expDate
	};

	return tokenData;
}

export function generateUserTokenData(userRecord: UserRecord): TokenDataPair {
	const accessTokenPayload: AccessTokenPayload = {
		access_type: 'USER',
		authenticated_user: {
			access_level: userRecord.access_level,
			_id: userRecord._id
		}
	};

	const accessTokenData: AccessTokenData = createAccessTokenData(
		accessTokenPayload,
		ACCESS_TOKEN_LIFE_SECS
	);

	const refreshTokenPayload: RefreshTokenPayload = {
		_id: userRecord._id
	};
	const refreshTokenData: RefreshTokenData = createRefreshTokenData(
		refreshTokenPayload,
		REFRESH_TOKEN_LIFE_SECS
	);

	const tokenDataPair: TokenDataPair = { accessTokenData, refreshTokenData };
	return tokenDataPair;
}
