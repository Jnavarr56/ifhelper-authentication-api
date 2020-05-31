import * as e from 'express';
import * as dotenv from 'dotenv';
import { google } from 'googleapis';
import { GOOGLE_OAUTH_SCOPE } from '../vars';
import { GoogleSignInResponse } from '../types/Response';
import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';

import BaseController from './BaseController';

dotenv.config();

const oauth2Client: OAuth2Client = new google.auth.OAuth2(
	process.env.GOOGLE_OAUTH_CLIENT_ID,
	process.env.GOOGLE_OAUTH_REDIRECT_URL,
	process.env.GOOGLE_OAUTH_REDIRECT_URL
);

export default class GoogleSignInController extends BaseController {
	protected async executeImpl(req: e.Request, res: e.Response): Promise<void> {
		// 1) import oauth scopes.
		const scope: string[] = GOOGLE_OAUTH_SCOPE;

		// 2) get the url to the google oauth consent screen.
		const consentScreenURL: string = oauth2Client.generateAuthUrl({ scope });

		// 3) format and send to user.
		const response: GoogleSignInResponse = {
			consent_screen_url: consentScreenURL
		};

		this.ok(res, response);
	}
}
