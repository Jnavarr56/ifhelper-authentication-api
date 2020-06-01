import e from 'express';
import * as dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import axios, { AxiosError } from 'axios';

import {
	UserRecord,
	UserUpdateFields,
	UserCreateFields,
	CreationResponse,
	UpdateResponse,
	ArrayFetchResponse,
	ItemFetchResponse
} from '../types/User';
import {
	NewTokenStoreFields,
	RefreshTokenData,
	AccessTokenData,
	TokenDataPair,
	AccessTokenPayload,
	RefreshTokenPayload
} from '../types/Token';
import { AuthorizedConfig } from '../types';

import AuthTokenManager from './AuthTokenCache';
import { createAccessTokenData, createRefreshTokenData } from './tokens';

import TokenStore from '../models/TokenStore';

import {
	USERS_API,
	REFRESH_TOKEN_COOKIE_NAME,
	ACCESS_TOKEN_LIFE_SECS,
	REFRESH_TOKEN_LIFE_SECS
} from '../vars';

dotenv.config();

export default class User {
	private user: UserRecord | null = null;
	private static authTokenCache: AuthTokenManager = new AuthTokenManager();

	public exists(): boolean {
		return this.user !== null;
	}

	private async generateAuthorizedConfig(): Promise<AuthorizedConfig> {
		const token = await User.authTokenCache.generateSystemAuthToken();
		const config: AuthorizedConfig = {
			headers: { Authorization: `Bearer ${token}` }
		};
		return config;
	}

	public async create(newUserData: UserCreateFields): Promise<void> {
		const config: AuthorizedConfig = await this.generateAuthorizedConfig();
		return axios
			.post(USERS_API, newUserData, config)
			.then((response: CreationResponse): void => {
				const newUser: UserRecord = response.data.new_user;
				this.user = newUser;
			});
	}

	public async update(updatedUserData: UserUpdateFields): Promise<void> {
		if (!this.user) throw new Error('User Not Initialized');

		const config: AuthorizedConfig = await this.generateAuthorizedConfig();
		const URL = `${USERS_API}/${this.user._id}`;

		return axios
			.patch(URL, updatedUserData, config)
			.then((response: UpdateResponse): void => {
				const updatedUser: UserRecord = response.data.updated_user;
				this.user = updatedUser;
			});
	}

	public async initByEmail(email: string): Promise<void> {
		const config: AuthorizedConfig = await this.generateAuthorizedConfig();
		const queryURL = `${USERS_API}?email=${email}&limit=1`;

		return axios
			.get(queryURL, config)
			.then((response: ArrayFetchResponse): void => {
				const queryResults: UserRecord[] = response.data.query_results;
				const user: UserRecord | null = queryResults[0] || null;
				this.user = user;
			});
	}

	public async initByID(id: string): Promise<void> {
		const config: AuthorizedConfig = await await this.generateAuthorizedConfig();
		const queryURL = `${USERS_API}/${id}`;

		return axios
			.get(queryURL, config)
			.then((response: ItemFetchResponse): void => {
				const user: UserRecord | null = response.data || null;
				this.user = user;
			})
			.catch((error: AxiosError): void => {
				if (!error.response || (error.response && error.response.status !== 404)) {
					throw error;
				}
			});
	}

	public async initByGoogleID(googleID: string): Promise<void> {
		const config: AuthorizedConfig = await this.generateAuthorizedConfig();
		const queryURL = `${USERS_API}?google_id=${googleID}&limit=1`;

		return axios.get(queryURL, config).then((response: ArrayFetchResponse) => {
			const queryResults: UserRecord[] = response.data.query_results;
			const user: UserRecord | null = queryResults[0] || null;
			this.user = user;
		});
	}

	public hasPassword(password: string): Promise<boolean> {
		if (!this.user) throw new Error('User Not Initialized');
		return bcrypt.compare(password, this.user.password);
	}

	public confirmedEmail(): boolean {
		if (!this.user) throw new Error('User Not Initialized');
		return this.user.email_confirmed;
	}

	public getFields(): UserRecord {
		if (!this.user) throw new Error('User Not Initialized');
		return this.user;
	}

	public async generateUserTokenData(
		req: e.Request,
		res: e.Response
	): Promise<TokenDataPair> {
		if (!this.user) throw new Error('User Not Initialized');

		const accessTokenPayload: AccessTokenPayload = {
			access_type: 'USER',
			authenticated_user: {
				access_level: this.user.access_level,
				_id: this.user._id
			}
		};

		const accessTokenData: AccessTokenData = createAccessTokenData(
			accessTokenPayload,
			ACCESS_TOKEN_LIFE_SECS
		);

		const refreshTokenPayload: RefreshTokenPayload = {
			_id: this.user._id
		};
		const refreshTokenData: RefreshTokenData = createRefreshTokenData(
			refreshTokenPayload,
			REFRESH_TOKEN_LIFE_SECS
		);

		await User.authTokenCache.cacheToken(
			accessTokenData.token,
			accessTokenData.payload,
			accessTokenData.exp - accessTokenData.iat
		);

		// 10) save token data to db
		const tokenStoreData: NewTokenStoreFields = {
			user_id: this.user._id,
			access_token: accessTokenData.token,
			refresh_token: refreshTokenData.token,
			access_token_exp_date: accessTokenData.expDate,
			refresh_token_exp_date: refreshTokenData.expDate,
			requester_data: req.useragent
		};

		await TokenStore.create(tokenStoreData);

		//11) set refresh token in cache.
		res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshTokenData.token, {
			httpOnly: true,
			path: '/',
			expires: refreshTokenData.expDate
		});

		const tokenDataPair: TokenDataPair = {
			accessTokenData,
			refreshTokenData
		};
		return tokenDataPair;
	}
}
