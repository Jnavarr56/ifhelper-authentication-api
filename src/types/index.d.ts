import { AxiosRequestConfig } from 'axios';

export interface StringIndexable {
	[key: string]: unknown;
}

export interface AuthorizedConfig extends AxiosRequestConfig {
	headers: {
		Authorization: string;
	};
}
