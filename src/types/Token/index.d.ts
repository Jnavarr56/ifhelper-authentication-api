import { Details } from 'express-useragent';

export interface AccessTokenPayload {
	access_type: 'USER';
	authenticated_user: {
		access_level: string;
		_id: string;
	};
}

export interface RefreshTokenPayload {
	_id: string;
}

export interface SystemAccessTokenPayload {
	access_type: 'SYSTEM';
	authenticated_user?: {
		_id: string;
	};
}

export type TokenPayload =
	| AccessTokenPayload
	| SystemAccessTokenPayload
	| RefreshTokenPayload;

export type CachedPayload = AccessTokenPayload | SystemAccessTokenPayload;

export interface DecodedAccessTokenPayload extends AccessTokenPayload {
	exp: number;
	iat: number;
}

export interface DecodedSystemAccessTokenPayload
	extends SystemAccessTokenPayload {
	exp: number;
	iat: number;
}

export interface DecodedRefreshTokenPayload extends RefreshTokenPayload {
	exp: number;
	iat: number;
}

export type DecodedPayload =
	| DecodedAccessTokenPayload
	| DecodedSystemAccessTokenPayload;

export interface TokenDataOpts {
	accessTokenExpiresInSecs?: number;
	refreshTokenExpiresInSecs?: number;
}

export interface TokenData {
	token: string;
	payload: unknown;
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

export interface NewTokenStoreFields {
	user_id: string;
	access_token: string;
	refresh_token: string;
	access_token_exp_date: Date;
	refresh_token_exp_date: Date;
	requester_data: Details | undefined;
}

export interface TokenStoreFields {
	user_id: string;
	access_token: string;
	refresh_token: string;
	access_token_exp_date: Date;
	refresh_token_exp_date: Date;
	revoked: boolean;
	revoked_at: Date;
	requester_data: Details | undefined;
}
