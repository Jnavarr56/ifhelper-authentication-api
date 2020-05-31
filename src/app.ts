import express, { Application } from 'express';
import useragent from 'express-useragent';
import bodyParser from 'body-parser';
import bearerToken from 'express-bearer-token';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import cors, { CorsOptions } from 'cors';
import * as dotenv from 'dotenv';
import routes from './routes';
import { CLIENT_ORIGIN, PATHNAME } from './vars';

dotenv.config();

const app: Application = express();

const corsOpts: CorsOptions = {
	credentials: true,
	origin: CLIENT_ORIGIN,
	allowedHeaders: [
		'Access-Control-Allow-Credentials',
		'Authorization',
		'Content-Type'
	]
};

app
	.use(bodyParser.json())
	.use(bodyParser.urlencoded({ extended: true }))
	.use(useragent.express())
	.use(bearerToken())
	.use(cookieParser())
	.use(morgan('dev'))
	.use(cors(corsOpts));

app.options('*', cors(corsOpts));

app.use(PATHNAME, routes);

export default app;
