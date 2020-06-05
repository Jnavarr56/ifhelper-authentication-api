import app from './app';
import * as ampq from 'amqplib';
import mongoose, { ConnectionOptions } from 'mongoose';
import { PORT, AUTHORIZATION_QUEUE_NAME, RABBIT_MQ_URL } from './vars';
import { RedisClient } from 'redis';
import RedisSingleton from './util/RedisSingleton';
import * as dotenv from 'dotenv';
import AuthTokenCache from './util/AuthTokenCache';

dotenv.config();

const { MONGO_DB_URL } = process.env;

const redisClient: RedisClient = new RedisSingleton().getInstance();

redisClient.on('connect', async () => {
	const rabbitMQConnection: ampq.Connection = await ampq.connect(RABBIT_MQ_URL);
	const rabbitMQChannel: ampq.Channel = await rabbitMQConnection.createChannel();
	const authTokenCache: AuthTokenCache = new AuthTokenCache();

	rabbitMQChannel.assertQueue(AUTHORIZATION_QUEUE_NAME, { durable: false });
	rabbitMQChannel.prefetch(1);
	rabbitMQChannel.consume(
		AUTHORIZATION_QUEUE_NAME,
		async (msg: ampq.ConsumeMessage | null) => {
			if (msg) {
				const token: string = await authTokenCache.generateSystemAuthToken();
				rabbitMQChannel.sendToQueue(msg.properties.replyTo, new Buffer(token), {
					correlationId: msg.properties.correlationId
				});
				rabbitMQChannel.ack(msg);
			}
		}
	);

	const dbURL = `${MONGO_DB_URL}/authentication-api?retryWrites=true&w=majority`;
	const dbOptions: ConnectionOptions = {
		useNewUrlParser: true,
		useCreateIndex: true,
		useUnifiedTopology: true
	};

	await mongoose.connect(dbURL, dbOptions);
	app.listen(PORT, () => {
		console.log(
			`Authentication API running on ${PORT} of http://authentication-api!`
		);
	});
});
