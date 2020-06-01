import * as e from 'express';
import * as dotenv from 'dotenv';
import { google, oauth2_v2 } from 'googleapis';
import { Credentials } from 'google-auth-library/build/src/auth/credentials';
import {
	OAuth2Client,
	GetTokenResponse
} from 'google-auth-library/build/src/auth/oauth2client';

import User from '../util/User';
import { TokenDataPair, AccessTokenData } from '../types/Token';
import {
	UserRecord,
	UserUpdateFields,
	UserCreateFields,
	UserGoogleOAuthValidationFields
} from '../types/User';
import { SignInResponse } from '../types/Response';

import BaseController from './BaseController';

dotenv.config();

const oauth2Client: OAuth2Client = new google.auth.OAuth2(
	process.env.GOOGLE_OAUTH_CLIENT_ID,
	process.env.GOOGLE_OAUTH_SECRET,
	process.env.GOOGLE_OAUTH_REDIRECT_URL
);

export default class GoogleCallbackController extends BaseController {
	protected async executeImpl(req: e.Request, res: e.Response): Promise<void> {
		// 1) check for authorization code, reject if missing.
		const authCode: string | null =
			typeof req.query.code === 'string' ? req.query.code : null;

		if (!authCode) {
			return this.missingParams(res, 'Authorization Code');
		}

		// 2) exchange authorization code for tokens.
		const tokens: Credentials = await oauth2Client.getToken(authCode).then(
			(response: GetTokenResponse): Credentials => {
				console.log('hi');
				const tokens: Credentials = response.tokens;
				return tokens;
			}
		);
		// 3) use tokens as credentials to initialize an authorized api client.
		const authorizedClient: OAuth2Client = new google.auth.OAuth2();
		authorizedClient.setCredentials(tokens);

		// 4) fetch user's google profile using api client.
		const userGoogleProfile: oauth2_v2.Schema$Userinfo = await google
			.oauth2({
				auth: authorizedClient,
				version: 'v2'
			})
			.userinfo.v2.me.get()
			.then(({ data: profile }): oauth2_v2.Schema$Userinfo => profile);

		// 5) assert email and id in google user profile are valid strings.
		const googleID: string | null | undefined = userGoogleProfile.id;
		const gmail: string | null | undefined = userGoogleProfile.email;
		if (!gmail || !googleID) {
			return this.fail(res, new Error('Invalid Google User Profile'));
		}

		// 6) try to find user in our database with email that is equal to
		// the email in the google user profile.
		const user: User = new User();
		await user.initByEmail(gmail);

		// 6) if no user in database exists with this email then try to pull
		// a user with google_id equal to the id in the google user profile.
		if (!user.exists()) await user.initByGoogleID(googleID);

		if (user.exists()) {
			// 7) if user exists then make sure relevant fields are correct.
			// if any fields are not correct then update the user with the
			// correct field values.

			const currentFieldValues: UserRecord = user.getFields();
			const properFieldValues: UserGoogleOAuthValidationFields = {
				google_id: googleID,
				email: gmail,
				email_confirmed: true
			};

			const fieldsToUpdate: UserUpdateFields = {};

			Object.keys(currentFieldValues).forEach((field: string): void => {
				if (properFieldValues[field] !== currentFieldValues[field]) {
					fieldsToUpdate[field] = properFieldValues[field];
				}
			});

			if (Object.keys(fieldsToUpdate).length > 0)
				await user.update(fieldsToUpdate);
		} else {
			// 7) if user does not exist then create the user using values.
			// extracted from the user's google pfoile.
			// correct field values.
			const lastName: string | null | undefined = userGoogleProfile.family_name;
			const firstName: string | null | undefined = userGoogleProfile.given_name;
			if (!firstName || !lastName) {
				return this.fail(res, new Error('Invalid Google User Profile'));
			}

			const newUserData: UserCreateFields = {
				google_id: googleID,
				email: gmail,
				first_name: firstName,
				last_name: lastName,
				password: googleID,
				email_confirmed: true
			};

			await user.create(newUserData);
		}

		// 8) initialize user tokens and persist
		const userTokenData: TokenDataPair = await user.generateUserTokenData(
			req,
			res
		);
		const accessTokenData: AccessTokenData = userTokenData.accessTokenData;

		// 9) format and send
		const response: SignInResponse = {
			access_token: accessTokenData.token,
			...accessTokenData.payload
		};
		this.ok(res, response);
	}
}
