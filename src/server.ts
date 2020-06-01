import app from './app';
import mongoose, { ConnectionOptions } from 'mongoose';
import { PORT } from './vars';
import { RedisClient } from 'redis';
import RedisSingleton from './util/RedisSingleton';
import * as dotenv from 'dotenv';

dotenv.config();

const { MONGO_DB_URL } = process.env;

const redisClient: RedisClient = new RedisSingleton().getInstance();

redisClient.on('connect', () => {
	const dbURL = `${MONGO_DB_URL}/authentication-api?retryWrites=true&w=majority`;
	const dbOptions: ConnectionOptions = {
		useNewUrlParser: true,
		useCreateIndex: true,
		useUnifiedTopology: true
	};

	mongoose
		.connect(dbURL, dbOptions)
		.then(() => {
			app.listen(PORT, () => {
				console.log(
					`Authentication API running on ${PORT} of http://authentication-api!`
				);
			});
		})
		.catch((error: Error) => {
			console.trace(error);
			process.exit(1);
		});
});
