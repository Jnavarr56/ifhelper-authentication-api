import { Request } from "express";

export interface RequestWithIpInfo extends Request {
	ipInfo: any;
}

export interface UserRecord {
	_id: string;
	first_name: string;
	last_name: string;
	password: string;
	email: string;
	email_confirmed: boolean;
	access_level: string;
}

export interface FetchUserError {
	data: any;
	status: number;
}

export interface RefreshTokenPayload {
	_id: string;
}

export interface AccessTokenPayload {
	access_type: string;
	authenticated_user: {
		access_level: string;
		_id: string;
	};
}
export interface TokenDataOpts {
	accessTokenExpiresInSecs?: number;
	refreshTokenExpiresInSecs?: number;
}

export interface TokenData {
	token: string;
	payload: any;
	exp: number;
	expDate: Date;
	iat: number;
}

export interface AccessTokenData extends TokenData {
	payload: AccessTokenPayload;
}

export interface RefreshTokenData extends TokenData {
	payload: RefreshTokenPayload;
}

export interface TokenDataPair {
	accessTokenData: AccessTokenData;
	refreshTokenData: RefreshTokenData;
}

export interface TokenStoreFields {
	user_id: string;
	access_token: string;
	refresh_token: string;
	access_token_exp_date: Date;
	refresh_token_exp_date: Date;
	requester_data: any;
}

export interface SignInResponse extends AccessTokenPayload {
	access_token: string;
}
