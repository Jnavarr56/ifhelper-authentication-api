import { UserRecord, TokenDataPair } from "../types";
import { fetchUserByEmail, fetchUserById } from "./users";
import { createUserTokenData } from "./tokens";
import bcrypt from "bcrypt";

class User {
	private _user: UserRecord;
	public constructor() {
		this._user = null;
	}

	public exists(): boolean {
		return Boolean(this._user);
	}

	public initByEmail(email: string): Promise<void> {
		return new Promise((resolve) => {
			fetchUserByEmail(email).then((user: UserRecord) => {
				this._user = user;
				resolve();
			});
		});
	}

	public initByID(id: string): Promise<void> {
		return new Promise((resolve) => {
			fetchUserById(id).then((user: UserRecord) => {
				this._user = user;
				resolve();
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
