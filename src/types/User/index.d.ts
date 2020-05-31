import { StringIndexable } from '../';
import { AxiosResponse } from 'axios';

export interface UserRecord extends StringIndexable {
	_id: string;
	google_id: string | null;
	first_name: string;
	last_name: string;
	password: string;
	email: string;
	email_confirmed: boolean;
	access_level: string;
}

export interface UserCreateFields extends StringIndexable {
	google_id?: string;
	first_name: string;
	last_name: string;
	password: string;
	email: string;
	email_confirmed?: boolean;
	access_level?: string;
}

export interface UserUpdateFields extends StringIndexable {
	google_id?: string | null;
	first_name?: string;
	last_name?: string;
	password?: string;
	email?: string;
	email_confirmed?: boolean;
	access_level?: string;
}

export interface UserGoogleOAuthValidationFields extends StringIndexable {
	google_id?: string;
	email?: string;
	email_confirmed?: true;
}

export interface ArrayFetchResponse extends AxiosResponse {
	data: {
		query_results: UserRecord[];
	};
}

export interface ItemFetchResponse extends AxiosResponse {
	data: UserRecord;
}

export interface CreationResponse extends AxiosResponse {
	data: {
		new_user: UserRecord;
	};
}

export interface UpdateResponse extends AxiosResponse {
	data: {
		updated_user: UserRecord;
	};
}
