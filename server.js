const redis = require("redis");
const axios = require('axios');
const morgan = require("morgan");
const bcrpyt = require('bcrypt');
const express = require("express");
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const expressip = require('express-ip');
const nodemailer = require('nodemailer');
const bodyParser = require("body-parser");
const cookieParser = require('cookie-parser');
const useragent = require('express-useragent');
const bearerToken = require('express-bearer-token');
const cryptoRandomString = require('crypto-random-string');

const { TokenStore } = require('./db/models');

require('dotenv').config();

const PORT = process.env.PORT || 3000;
const REDIS_PORT = process.env.REDIS_PORT || 6379;

const REFRESH_TOKEN_COOKIE_NAME = process.env.REFRESH_TOKEN_COOKIE_NAME;

const USERS_API = "http://localhost:4000/users";

const MONGO_DB_URL = "mongodb://127.0.0.1:27017";

const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY;

const userAuthTokenCache = redis.createClient({
	port: REDIS_PORT,
	prefix: 'USER_AUTHENTICATION'
});

const setInUserAuthTokenCache = (accessToken, payload, secs) => {
    return new Promise((resolve) => {
        userAuthTokenCache.set(
            accessToken, 
            JSON.stringify(payload), 
            'EX', 
            secs, 
            (cacheError, status) => resolve({ cacheError, status })
        );         
    });
};

const checkUserAuthTokenCache = (accessToken) => {
    return new Promise((resolve) => {
        userAuthTokenCache.get(accessToken, (cacheError, cachedVal) => {
            resolve({ cacheError, cachedVal: JSON.parse(cachedVal) });
        });        
    });
};

const userAuthTokenBlacklistCache = redis.createClient({
	port: REDIS_PORT,
	prefix: 'USER_AUTHENTICATION_BLACKLIST'
});

const setInUserAuthTokenBlacklistCache = (accessToken, payload, secs) => {
    return new Promise((resolve) => {
        userAuthTokenBlacklistCache.set(
            accessToken, 
            JSON.stringify(payload), 
            'EX', 
            secs, 
            (cacheError, status) => resolve({ cacheError, status })
        );         
    });
};

const checkUserAuthTokenBlacklistCache = (accessToken) => {
    return new Promise((resolve) => {
        userAuthTokenBlacklistCache.get(accessToken, (cacheError, cachedVal) => {
            resolve({ cacheError, cachedVal: JSON.parse(cachedVal) });
        });        
    });
};



const app = express();

app
	.use(bodyParser.urlencoded({ extended: true }))
	.use(bodyParser.json())
	.use(useragent.express())
	.use(expressip().getIpInfoMiddleware)
	.use(bearerToken())
	.use(cookieParser())
	.use(morgan("dev"));


const generateSystemAuthToken = async () => {
	const sysAuthToken = "SYS" + cryptoRandomString({length: 10, type: 'base64'});
	const payload = { access_type: "SYSTEM" };

	const {
		cacheError,
		status
	} = await setInUserAuthTokenCache(sysAuthToken, payload,  60 * 60);

	if (cacheError || status !== "OK") {
		console.trace(cacheError, status);
		throw new Error(cacheError);
	}

	return sysAuthToken;
}

const fetchUserByEmail = async (email) => {
	// Fetch user by email. 
	
	// If no user  with email return null.
	// If error then return formatted data object.

	const token = await generateSystemAuthToken();
	const headers = {
		Authorization: `Bearer ${token}`
	} 
	
	console.log({ headers });

	const APIQueryURL = `${USERS_API}?email=${email}&limit=1`;

	return axios.get(APIQueryURL, { headers })
		.then(({ data }) => ({ user: data.query_results[0] || null }))
		.catch(({ response: { data, status } }) => ({
			error: { data, status, error_code: "PROBLEM RETRIEVING USER" }
		}));
}

const fetchUserById = async (id) => {
	// Fetch user by id. 
	
	// If no user  with id return null.
	// If error then return formatted data object.

	const token = await generateSystemAuthToken();
	
	const headers = {
		Authorization: `Bearer ${token}`
	} 

	const APIQueryURL = `${USERS_API}/${id}`;
	return axios.get(APIQueryURL, { headers })
		.then(({ data: { user } }) => ({ user }))
		.catch(({ response: { data, status } }) => {
			if (status === 404) {
				return null;
			} 

			return {
				error: { 
					data, 
					status, 
					error_code: "PROBLEM RETRIEVING USER" 
				}
			}
		});
};

const createUser = async (signUpData) => {
	// Create user
	const token = await generateSystemAuthToken();
	
	const headers = { Authorization: `Bearer ${token}` } 

    return axios.post(USERS_API, signUpData, { headers })
        .then(({ data: { new_user: newUser } }) => ({ newUser }))
        .catch(({ response: { data, status }}) => ({ error: { status, data } }));
}

const verifyUserPassword = (unhashedPwd, hashedPwd) => {
	// Check if a hashed password matches an unhashed password.
	return bcrpyt.compareSync(unhashedPwd, hashedPwd)
};

const generateUserTokens = (user, options) => {

	// Produce tokens from user record.

	const { access_level, _id } = user;
	const { 
		// Default to 1 Hour.
		accessTokenExpiresIn = 60 * 60, 
		// Default to 1 Week.
		refreshTokenExpiresIn = 60 * 60 * 24 * 7
	} = options;

	const accessTokenPayload = {
		access_type: "USER",
		authenticated_user: { access_level, _id } 
	}; 

	const accessToken = jwt.sign
		(accessTokenPayload, 
		JWT_SECRET_KEY, 
		{ expiresIn: accessTokenExpiresIn}
	);

	const refreshTokenPayload = { _id };

	const refreshToken = jwt.sign(
		refreshTokenPayload, 
		JWT_SECRET_KEY, 
		{ expiresIn: refreshTokenExpiresIn }
	);

	const accessTokenDecoded = jwt.verify(accessToken, JWT_SECRET_KEY);
	const refreshTokenDecoded = jwt.verify(refreshToken, JWT_SECRET_KEY);

	return ({
		accessToken: {
			token: accessToken,
			payload: accessTokenPayload,
			exp: accessTokenDecoded.exp,
			expDate: new Date(accessTokenDecoded.exp * 1000),
			iat: accessTokenDecoded.iat
		},
		refreshToken: {
			token: refreshToken,
			payload: refreshTokenPayload,
			exp: refreshTokenDecoded.exp,
			expDate: new Date(refreshTokenDecoded.exp * 1000),
			iat: refreshTokenDecoded.iat
		}
	})
}

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



// public
app.post('/sign-in', async (req, res) => {

	const { email, password } = req.body;

	// If email or password not supplied send bad 400 back error.
	if (!email || !password) {
		return res.status(400).send({ error_code: "MISSING EMAIL OR PASSWORD" });
	} 

	// Fetch user by submitted email. If user does not exist return 401 error.
	const { user, error: userFetchError }  = await fetchUserByEmail(email);

	if (userFetchError) {
		const { data: error, status, error_code } = userFetchError;
		console.trace(error_code, error);
		return res.status(status).send({  error_code, error });
	} else if (user === null) {
		return res.status(401).send({ 
			error_code: 'EMAIL/PASSWORD COMBINATION NOT RECOGNIZED' 
		});
	}

	// Check submitted password against hased password in DB.
	// If not a match, send back 401 error.
	const passwordIsValid = verifyUserPassword(password, user.password);
	if (!passwordIsValid) {
		return res.status(401).send({ 
			error_code: 'EMAIL/PASSWORD COMBINATION NOT RECOGNIZED' 
		});
	}


	// Create auth tokens for user.
	// These are objects filled with the data
	//  relevant to each token including the token iteself.
	const { 
		accessToken, 
		refreshToken  
	} = generateUserTokens(user, {
		accessTokenExpiresIn: 60 * 60, // 1 Hour
		refreshTokenExpiresIn: 60 * 60 * 24 * 7 // 1 Week
	});


	// Save token/sign-in data to db for record keeping 
	// puropses. Send 500 error if there is a problem.
	try {

		await TokenStore.create({
			user_id: user._id,
			access_token: accessToken.token,
			refresh_token: refreshToken.token,
			access_token_exp_date: accessToken.expDate,
			refresh_token_exp_date: refreshToken.expDate,
			requester_data: { ...req.useragent, ...req.ipInfo }
		});
	
	} catch(error) {
		const error_code = "PROBLEM STORING CREDENTIALS";
		console.trace(error_code, error);
		return res.status(500).send({ error_code });
	}


	// Cache accessToken data for its life span of token.
	// Use the accessToken as the key and its payload 
	// and exp/iat data as the value. Return 500 error if
	// there is a problem.
	/* (accessToken.payload)
		{
			"access_type": "USER",
			"authenticated_user": {
				"access_level": (user.access_level),
				"_id": (user._id)
			}
		}
	*/
	const { 
		status, 
		cacheError 
	} = await setInUserAuthTokenCache(
		accessToken.token, 
		{
			...accessToken.payload,		
			exp: accessToken.exp,
			iat: accessToken.iat
		},
		accessToken.exp - accessToken.iat
	);

	if (status !== "OK" || cacheError) {
		const error_code = "PROBLEM STORING CREDENTIALS";
		console.trace(error_code, error);
		return res.status(500).send({ error_code });
	}

	// Set refresh token in httpOnly cookie for its lifespan.
	res.cookie(
		REFRESH_TOKEN_COOKIE_NAME, 
		refreshToken.token, 
		{
			httpOnly: true,
			expires: refreshToken.expDate
		}
	);

	// Set send back access token and payload.
	/*
		{
			"access_token": (token),
			"access_type": "USER",
			"authenticated_user": {
				"access_level": (user.access_level),
				"_id": (user._id)
			}
		}
	*/
	return res.send({
		access_token: accessToken.token,
		...accessToken.payload
	});
	
});

// need token
app.get('/authorize', async (req, res) => {

	const { token: access_token } = req;

	// Check for access_token in header. If missing,
	// send back 400 error.
	if (!access_token) {
		return res.status(400).send({ 
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	const { 
		cacheError: blacklistCacheError, 
		cachedVal: blacklistCachedVal 
	} = await checkUserAuthTokenBlacklistCache(access_token);

	if (blacklistCacheError) {
		const error_code = "PROBLEM CHECKING BLACKLIST CACHE";
		console.trace(error_code, blacklistCacheError);
		return res.status(500).send({ error_code });
	} else if (blacklistCachedVal) {
		res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
		return res.status(401).send({ 
			error_code: "TOKEN INVALID"
		});
	}

	// Check if access_token is in the cache as a key.	
	// If it is not cachedVal will be null.
	// The following would be the value if true:
	/*
		{
			"access_type": "USER",
			"authenticated_user": {
				"access_level": (user.access_level),
				"_id": (user._id)
			}
		}
	*/
	// Send 500 error if there is a problem.
	const { 
		cacheError, 
		cachedVal 
	} = await checkUserAuthTokenCache(access_token);
	


	if (cachedVal) {

		if (access_token.slice(0, 3) === "SYS") {
			const { exp, iat, ...rest } = cachedVal;
			userAuthTokenCache.del(access_token);
			return res.send({ ...rest });
		}

		// If access_token is in cache, make refresh token
		// is present. Reset it if it is not. If there is
		// a problem, send back an error determined by function.
		const { 
			error: resetRefreshTokenError
		} = await validateRefreshTokenCookie(req, res, access_token);

		if (resetRefreshTokenError) {
			const { error, status, code } = resetRefreshTokenError;
			console.trace(code, error);
			return res.status(status).send({  error_code: code });
		}

		const { exp, iat, ...rest } = cachedVal;
		return res.send({ ...rest });

	} else if (cacheError) {

		// If there was a problem reading the cache
		// then send back a 500 error.
		const error_code = "PROBLEM READING CACHE";
		console.trace(cacheError, error_code)
		return res.status(500).send({ error_code });
	}

	// Since token is not in cache, verify token directly.
	jwt.verify(access_token, JWT_SECRET_KEY, async (error, decodedAccessToken) => {

		if (error) {
			const { name } = error;
			let error_code;
			if (name === "TokenExpiredError") {
				error_code = "TOKEN EXPIRED";
			} else {
				// Wipe refresh token cookie if token is invalid.
				error_code = "TOKEN INVALID";
				res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
			}
			
			return res.status(401).send({ error_code });
		}

		// Validate refresh token if needed;
		const { 
			error: resetRefreshTokenError
		} = await validateRefreshTokenCookie(req, res, access_token);

		if (resetRefreshTokenError) {
			const { error, status, code } = resetRefreshTokenError;
			console.trace(code, error);
			return res.status(status).send({  error_code: code });
		}

		//Set decoded token in cache.
		const { 
			status, 
			cacheError 
		} = await setInUserAuthTokenCache(
			access_token, 
			decodedAccessToken,
			decodedAccessToken.exp - decodedAccessToken.iat
		);
	
		if (status !== "OK" || cacheError) {
			const error_code = "PROBLEM STORING CREDENTIALS";
			console.trace(error_code, error);
			return res.status(500).send({ error_code });
		}

		const { exp, iat, ...accessTokenPayload } = decodedAccessToken;
		return res.send({ ...accessTokenPayload });
	});
});

// need token
app.get('/refresh', async (req, res) => {

	// Check for access_token in header. If missing,
	// send back 400 error.
	const { token: access_token } = req;
	if (!access_token) {
		return res.status(400).send({ 
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	const { 
		cacheError: blacklistCacheError, 
		cachedVal: blacklistCachedVal 
	} = await checkUserAuthTokenBlacklistCache(access_token);

	if (blacklistCacheError) {
		const error_code = "PROBLEM CHECKING BLACKLIST CACHE";
		console.trace(error_code, blacklistCacheError);
		return res.status(500).send({ error_code });
	} else if (blacklistCachedVal) {
		res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
		return res.status(401).send({ 
			error_code: "TOKEN INVALID"
		});
	}

	// Check for refresh_token in cookie. If missing,
	// send back 401 error.
	const refresh_token = req.cookies[REFRESH_TOKEN_COOKIE_NAME];
	if (!refresh_token) {
		return res.status(401).send({ 
			error_code: "REFRESH TOKEN INVALID"
		});
	}


	let tokenStore;

	// Pull relevant TokenStore record based on access_token and refresh_token
	// to verify pairing.
	try {
		tokenStore = await TokenStore.findOne({ access_token, refresh_token });

		if (tokenStore === null) {
			const error_code = "NO RECORD OF CURRENT TOKEN PAIRING EXISTS";
			console.trace(error_code);
			res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
			return res.status(401).send({ error_code });
		}

	} catch(error) {
		const error_code = "PROBLEM RETRIEVING TOKEN RECORD";
		console.trace(error, error_code);
		return res.status(500).send({ error_code });
	}

	// Take tokenStore and use tokenStore.user_id to pull user record.
	const { user_id } = tokenStore;
	const { user, error: userFetchError } = await fetchUserById(user_id);

	// If user does not exist return an error.
	if (userFetchError) {
		const { data, status, error_code } = userFetchError;
		console.trace(error_code, data);
		return res.status(status).send({ error_code });
	}

	// Generate new tokens for the user.
	const { 
		accessToken, 
		refreshToken  
	} = generateUserTokens(user, {
		accessTokenExpiresIn: 60 * 60, // 1 Hour
		refreshTokenExpiresIn: 60 * 60 * 24 * 7 // 1 Week
	});



	// Save token/sign-in data to db for record keeping 
	// puropses. Send 500 error if there is a problem.
	try {

		await TokenStore.create({
			user_id: user._id,
			access_token: accessToken.token,
			refresh_token: refreshToken.token,
			access_token_exp_date: accessToken.expDate,
			refresh_token_exp_date: refreshToken.expDate,
			requester_data: { ...req.useragent, ...req.ipInfo }
		});
	
	} catch(error) {
		const error_code = "PROBLEM STORING CREDENTIALS";
		console.trace(error_code, error);
		return res.status(500).send({ error_code });
	}


	// Cache accessToken data for its life span of token.
	// Use the accessToken as the key and its payload 
	// and exp/iat data as the value. Return 500 error if
	// there is a problem.
	/* (accessToken.payload)
		{
			"access_type": "USER",
			"authenticated_user": {
				"access_level": (user.access_level),
				"_id": (user._id)
			}
		}
	*/
	const { 
		status, 
		cacheError 
	} = await setInUserAuthTokenCache(
		accessToken.token, 
		{
			...accessToken.payload,		
			exp: accessToken.exp,
			iat: accessToken.iat
		},
		accessToken.exp - accessToken.iat
	);

	if (status !== "OK" || cacheError) {
		const error_code = "PROBLEM STORING CREDENTIALS";
		console.trace(error_code, error);
		return res.status(500).send({ error_code });
	}

	// Set refresh token in httpOnly cookie for its lifespan.
	res.cookie(
		REFRESH_TOKEN_COOKIE_NAME, 
		refreshToken.token, 
		{
			httpOnly: true,
			expires: refreshToken.expDate
		}
	);

	return res.send({
		access_token: accessToken.token,
		...accessToken.payload
	});

});

// need token
app.get('/sign-out', async (req, res) => {

	const { token: access_token } = req;

	// Check for access_token in header. If missing,
	// send back 400 error.
	if (!access_token) {
		return res.status(400).send({ 
			error_code: "MISSING AUTHORIZATION BEARER TOKEN"
		});
	}

	const { 
		cacheError: blacklistCacheError, 
		cachedVal: blacklistCachedVal
	} = await checkUserAuthTokenBlacklistCache(access_token);

	if (blacklistCacheError) {
		console.trace("PROBLEM CHECKING BLACKLIST CACHE");
	}

	if (blacklistCachedVal) {
		return res.status(400).send({ 
			error_code: "TOKEN ALREADY BLACKLISTED"
		});
	}

	jwt.verify(access_token, JWT_SECRET_KEY, async (error, decodedToken) => {
		if (error) {
			return res.status(400).send({ 
				error_code: "TOKEN ALREADY INVALID"
			});
		}

		const { exp, iat } = decodedToken;

		const { 
			status, 
			cacheError
		} = await setInUserAuthTokenBlacklistCache(access_token, { created_at: new Date() }, exp - iat);

		if (status !== "OK" || cacheError) {
			const error_code = "PROBLEM BLACKLISTING TOKEN";
			console.log(error_code, cacheError);
			return res.send(500)({ error_code });
		}

		return res.send("SUCCESS");
	});	
});

// public

const transporter = nodemailer.createTransport({
	service: 'gmail',
	auth: {
		user: process.env.GMAIL_ADDRESS,
		pass: process.env.GMAIL_PASSWORD
	}
});



app.post('/sign-up', async (req, res) => {
	const { body: signUpData } = req;

	const { error, newUser: new_user } = await createUser(signUpData);

	if (error) {
		const { data, status } = error;
		const error_code = data.error_code || "PROBLEM CREATING USER";
		console.trace(error_code, data);
		return res.status(status).send({ error_code });
	}

	const mailOptions = {
		to: new_user.email,
		subject: 'IFHelper Email Confirmation',
		html: `<p>Welcome to IFHelper ${new_user.first_name}!</p>`
	};

	transporter.sendMail(mailOptions, (error, info) => {
		console.log(error, info);
	});

	return res.send({ new_user });
});


const dbOptions = {
	useNewUrlParser: true,
	useUnifiedTopology: true
};

userAuthTokenCache.on("connect", error => {
	if (error) {
		console.log(error);
		process.exit(1);
	}

	mongoose.connect(`${MONGO_DB_URL}/authentication-api`, dbOptions, error => {
		if (error) {
			console.log(error);
			process.exit(1);
		}

		app.listen(PORT, () => {
			console.log(`Authentication API running on PORT ${PORT}!`);
		});
	});
});

