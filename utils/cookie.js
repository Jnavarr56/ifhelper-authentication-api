
const { TokenStore } = require('../db/models');
const { REFRESH_TOKEN_COOKIE_NAME } = process.env;


const validateRefreshTokenCookie = (req, res, access_token) => {

	// Parse cookies in req object for the refresh token cookie.
	// If it is there, then resolve successfully.
	// Otherwise, try to locate the TokenStore record that contains
	// the right refresh token and then set the token in a cookie on
	// the res object.

	return new Promise((resolve) => {
		if (req.cookies[REFRESH_TOKEN_COOKIE_NAME]) {
			return resolve({ error: null });
		}
		

		TokenStore.findOne({ access_token }, (error, tokenStore) => {

			if (error) {
				return resolve({ 
					error: {
						data: error,
						status: 500,
						code: "PROBLEM RETRIEVING REFRESH TOKEN"
					} 
				});
			} else if (tokenStore === null) {
				return resolve({ 
					error: {
						data: null,
						status: 500,
						code: "NO RECORD OF CURRENT TOKEN EXISTS"
					} 
				});
			}

			res.cookie(
				REFRESH_TOKEN_COOKIE_NAME, 
				tokenStore.refresh_token, 
				{
					httpOnly: true,
					expires: tokenStore.refresh_token_exp_date
				}
			);

			resolve({ error: null });
		})

	});
}

module.exports = { validateRefreshTokenCookie };