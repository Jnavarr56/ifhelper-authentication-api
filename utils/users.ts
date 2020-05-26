import axios, { AxiosResponse } from 'axios'
import bcrypt from 'bcrypt'
import { generateSystemAuthToken } from './tokens';
import { UserRecord } from '../types/index'


require("dotenv").config();

const { USERS_API ='http://server/api/users' } = process.env; 


type UserEmailStr = string;

interface EmailFetchResponse extends AxiosResponse {
	data: {
		query_results: [UserRecord]
	}
}

interface IDFetchResponse extends AxiosResponse {
	data: UserRecord
}


const fetchUserByEmail = async (email: UserEmailStr): Promise<UserRecord> => {

	const token = await generateSystemAuthToken(); 

	const headers = { Authorization: `Bearer ${token}` };
	const queryURL = `${USERS_API}?email=${email}&limit=1`;

	return new Promise((resolve) => {
		axios
		.get(queryURL, { headers })
		.then((response: EmailFetchResponse) => {
			const { query_results } = response.data;
			const user: UserRecord = query_results[0];
			resolve(user)
		})
	})
};


type UserIDStr = string;

const fetchUserById = async (id: UserIDStr): Promise<UserRecord> => {

	const token = await generateSystemAuthToken();

	const headers = { Authorization: `Bearer ${token}` };
	const queryURL = `${USERS_API}/${id}`;

	return new Promise((resolve, reject) => {
		axios
			.get(queryURL, { headers })
			.then((response: IDFetchResponse) => {
				const user: UserRecord = response.data;
				resolve(user);
			})
			.catch(error => {
				const { status } = error.response;
				if (status === 401) {
					resolve(null);
				} else {
					reject(error);
				}
			});
	})
};


type UserRecordPassword = string;
type DBPassword = string;

const isPasswordValid = (unhashedPwd: UserRecordPassword, hashedPwd: DBPassword): boolean => {
	return bcrypt.compareSync(unhashedPwd, hashedPwd);
};

export { fetchUserByEmail, fetchUserById, isPasswordValid };
