const axios = require('axios');
const bcrypt = require('bcrypt');
const { generateSystemAuthToken } = require('./tokens');

const USERS_API = "http://localhost:4000/users";

const fetchUserByEmail = async (email, tokenCache) => {
	// Fetch user by email. 
	
	// If no user  with email return null.
	// If error then return formatted data object.

	const token = await generateSystemAuthToken(tokenCache);
	const headers = {
		Authorization: `Bearer ${token}`
	} 

	const APIQueryURL = `${USERS_API}?email=${email}&limit=1`;

	return axios.get(APIQueryURL, { headers })
		.then(({ data }) => ({ user: data.query_results[0] || null }))
		.catch(({ response: { data, status } }) => ({
			error: { data, status, error_code: "PROBLEM RETRIEVING USER" }
		}));
}

const fetchUserById = async (id, tokenCache) => {
	// Fetch user by id. 
	
	// If no user  with id return null.
	// If error then return formatted data object.

	const token = await generateSystemAuthToken(tokenCache);
	
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

const createUser = async (signUpData, tokenCache) => {
	// Create user
	const token = await generateSystemAuthToken(tokenCache);
	
	const headers = { Authorization: `Bearer ${token}` } 

    return axios.post(USERS_API, signUpData, { headers })
        .then(({ data: { new_user: newUser } }) => ({ newUser }))
        .catch(({ response: { data, status }}) => ({ error: { status, data } }));
}

const verifyUserPassword = (unhashedPwd, hashedPwd) => {
	// Check if a hashed password matches an unhashed password.
	return bcrypt.compareSync(unhashedPwd, hashedPwd)
};

module.exports = { fetchUserByEmail, fetchUserById, createUser, verifyUserPassword };