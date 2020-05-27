import {
	UserRecord,
	TokenDataPair,
	NewUserFields,
	UpdateUserFields,
	RequestWithIpInfo
} from "../types";
import { createUserTokenData } from "./tokens";
import bcrypt from "bcrypt";
import axios, { AxiosResponse, AxiosRequestConfig } from "axios";
import { generateSystemAuthToken } from "./tokens";
import { Response } from "express";
import { TokenStore } from "../db/models";
import RedisCacheManager from "./RedisCacheManager";

require("dotenv").config();

const {
	USERS_API = "http://server/api/users",
	REDIS_PORT,
	REDIS_URL,
	REFRESH_TOKEN_COOKIE_NAME
} = process.env;

interface ArrayFetchResponse extends AxiosResponse {
	data: {
		query_results: [UserRecord];
	};
}

interface ItemFetchResponse extends AxiosResponse {
	data: UserRecord;
}

interface CreationResponse extends AxiosResponse {
	data: {
		new_user: UserRecord;
	};
}

interface UpdateResponse extends AxiosResponse {
	data: {
		updated_user: UserRecord;
	};
}

interface AuthorizedConfig extends AxiosRequestConfig {
	headers: {
		Authorization: string;
	};
}

const AuthTokenCache: RedisCacheManager = new RedisCacheManager({
	port: parseInt(REDIS_PORT) || 6379,
	url: REDIS_URL,
	prefix: "AUTHENTICATION_TOKENS"
});

class User {
	private _user: UserRecord;
	private _tokens: TokenDataPair;
	public constructor() {
		this._user = null;
		this._tokens = null;
	}

	public exists(): boolean {
		return Boolean(this._user);
	}

	public initializedTokens(): boolean {
		return Boolean(this._tokens);
	}

	private _validateExistence(): void {
		if (!this.exists()) throw new Error("NO USER INITIALIZED");
	}

	private _validateInitializedTokens(): void {
		if (!this.exists()) throw new Error("NO TOKENS INITIALIZED");
	}

	private async _generateAuthorizedConfig(): Promise<AuthorizedConfig> {
		const config: AuthorizedConfig = {
			headers: { Authorization: `Bearer ${await generateSystemAuthToken()}` }
		};

		return config;
	}

	public async create(fields: NewUserFields): Promise<void> {
		const config: AuthorizedConfig = await this._generateAuthorizedConfig();

		return new Promise((resolve) => {
			axios.post(USERS_API, fields, config).then((response: CreationResponse) => {
				const { new_user } = response.data;
				this._user = new_user;
				resolve();
			});
		});
	}

	public async update(fields: UpdateUserFields): Promise<void> {
		this._validateExistence();
		const config: AuthorizedConfig = await this._generateAuthorizedConfig();
		const patchURL = `${USERS_API}/${this._user._id}`;

		return new Promise((resolve) => {
			axios.patch(patchURL, fields, config).then((response: UpdateResponse) => {
				const { updated_user } = response.data;
				this._user = updated_user;
				resolve();
			});
		});
	}

	public async initByEmail(email: string): Promise<void> {
		const config: AuthorizedConfig = await this._generateAuthorizedConfig();
		const queryURL = `${USERS_API}?email=${email}&limit=1`;

		return new Promise((resolve) => {
			axios.get(queryURL, config).then((response: ArrayFetchResponse) => {
				const { query_results } = response.data;
				this._user = query_results[0];
				resolve();
			});
		});
	}

	public async initByID(id: string): Promise<void> {
		const config: AuthorizedConfig = await this._generateAuthorizedConfig();
		const queryURL = `${USERS_API}/${id}`;

		return new Promise((resolve, reject) => {
			axios
				.get(queryURL, config)
				.then((response: ItemFetchResponse) => {
					this._user = response.data;
					resolve();
				})
				.catch((error) => {
					if (error.response.status === 401) {
						resolve();
					} else {
						reject(error);
					}
				});
		});
	}

	public async initByGoogleID(googleID: string): Promise<void> {
		const config: AuthorizedConfig = await this._generateAuthorizedConfig();
		const queryURL = `${USERS_API}?google_id=${googleID}&limit=1`;
		return new Promise((resolve) => {
			axios.get(queryURL, config).then((response: ArrayFetchResponse) => {
				const { query_results } = response.data;
				this._user = query_results[0];
				resolve();
			});
		});
	}

	public hasPassword(password: string): boolean {
		this._validateExistence();
		return bcrypt.compareSync(password, this._user.password);
	}

	public confirmedEmail(): boolean {
		this._validateExistence();
		return this._user.email_confirmed;
	}

	public getFields(): UserRecord {
		this._validateExistence();
		return this._user;
	}

	public getTokens(): TokenDataPair {
		this._validateInitializedTokens();
		return this._tokens;
	}

	public initUserTokens(): TokenDataPair {
		this._validateExistence();
		this._tokens = createUserTokenData(this._user);
		return this._tokens;
	}

	public async storeUserTokens(req: RequestWithIpInfo): Promise<void> {
		this._validateInitializedTokens();
		const { accessTokenData, refreshTokenData } = this._tokens;
		return new Promise((resolve, reject) => {
			TokenStore.create(
				{
					user_id: this.getFields()._id,
					access_token: accessTokenData.token,
					refresh_token: refreshTokenData.token,
					access_token_exp_date: accessTokenData.expDate,
					refresh_token_exp_date: refreshTokenData.expDate,
					requester_data: { ...req.useragent, ...req.ipInfo }
				},
				(err: any) => {
					if (err) reject(err);
					resolve();
				}
			);
		});
	}

	public async cacheUserTokens(): Promise<void> {
		this._validateInitializedTokens();
		const { accessTokenData } = this._tokens;
		return new Promise((resolve, reject) => {
			AuthTokenCache.setKey(
				accessTokenData.token,
				accessTokenData.payload,
				accessTokenData.exp - accessTokenData.iat
			)
				.then(() => resolve())
				.catch((error) => reject(error));
		});
	}

	public setUserRefreshTokenCookie(res: Response): void {
		this._validateInitializedTokens();
		const { refreshTokenData } = this._tokens;
		res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshTokenData.token, {
			httpOnly: true,
			expires: refreshTokenData.expDate,
			sameSite: true
		});
	}
}

export default User;
