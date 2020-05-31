import {
	UserRecord,
	UserUpdateFields,
	UserCreateFields,
	CreationResponse,
	UpdateResponse,
	ArrayFetchResponse,
	ItemFetchResponse
} from '../types/User';
import { AuthorizedConfig } from '../types';
import bcrypt from 'bcrypt';
import axios, { AxiosError } from 'axios';
import { USERS_API } from '../vars';
import AuthTokenManager from './AuthTokenCache';

require('dotenv').config();

export default class User {
	private user: UserRecord | null = null;
	private static authTokenManager: AuthTokenManager = new AuthTokenManager();

	public exists(): boolean {
		return this.user !== null;
	}

	private async generateAuthorizedConfig(): Promise<AuthorizedConfig> {
		const token = await User.authTokenManager.generateSystemAuthToken();
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
}
