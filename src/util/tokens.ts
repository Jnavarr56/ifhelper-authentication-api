import jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';

import {
	AccessTokenData,
	AccessTokenPayload,
	DecodedAccessTokenPayload,
	RefreshTokenPayload,
	DecodedRefreshTokenPayload,
	RefreshTokenData
} from '../types/Token';

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
