import { SystemAccessTokenPayload, AccessTokenPayload } from '../Token';

export interface ErrorResponse {
	error_code: string;
	error?: unknown;
}

export interface SignInResponse extends AccessTokenPayload {
	access_token: string;
}

export interface GoogleSignInResponse {
	consent_screen_url: string;
}

export type AuthorizationResponse =
	| AccessTokenPayload
	| SystemAccessTokenPayload;

export type RefreshResponse = SignInResponse;
