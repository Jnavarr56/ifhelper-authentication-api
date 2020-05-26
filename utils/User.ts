import { UserRecord, TokenDataPair } from "../types";
import { createUserTokenData } from "./tokens";
import bcrypt from "bcrypt";
import axios, { AxiosResponse } from "axios";
import { generateSystemAuthToken } from "./tokens";

require("dotenv").config();

const { USERS_API = "http://server/api/users" } = process.env;

interface EmailFetchResponse extends AxiosResponse {
	data: {
		query_results: [UserRecord];
	};
}

interface IDFetchResponse extends AxiosResponse {
	data: UserRecord;
}

class User {
	private _user: UserRecord;
	public constructor() {
		this._user = null;
	}

	public exists(): boolean {
		return Boolean(this._user);
	}

	public async initByEmail(email: string): Promise<void> {
		const token = await generateSystemAuthToken();
		const headers = { Authorization: `Bearer ${token}` };
		const queryURL = `${USERS_API}?email=${email}&limit=1`;

		return new Promise((resolve) => {
			axios.get(queryURL, { headers }).then((response: EmailFetchResponse) => {
				const { query_results } = response.data;
				this._user = query_results[0];
				resolve();
			});
		});
	}

	public async initByID(id: string): Promise<void> {
		const token = await generateSystemAuthToken();
		const headers = { Authorization: `Bearer ${token}` };
		const queryURL = `${USERS_API}/${id}`;

		return new Promise((resolve, reject) => {
			axios
				.get(queryURL, { headers })
				.then((response: IDFetchResponse) => {
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

	public hasPassword(password: string): boolean {
		if (!this.exists()) throw new Error("NO USER INITIALIZED");
		return bcrypt.compareSync(password, this._user.password);
	}

	public confirmedEmail(): boolean {
		if (!this.exists()) throw new Error("NO USER INITIALIZED");
		return this._user.email_confirmed;
	}

	public getFields(): UserRecord {
		if (!this.exists()) throw new Error("NO USER INITIALIZED");
		return this._user;
	}

	public initUserTokens(): Promise<TokenDataPair> {
		if (!this.exists()) throw new Error("NO USER INITIALIZED");

		return new Promise(async (resolve) => {
			resolve(createUserTokenData(this._user));
		});
	}
}

export default User;
