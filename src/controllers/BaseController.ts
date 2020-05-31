import * as e from 'express';
import * as HTTPStatus from 'http-status-codes';
import { ErrorResponse } from '../types/Response';
// inspiration
//https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-consistent-expressjs-controllers/

export default abstract class BaseController {
	public async execute(req: e.Request, res: e.Response): Promise<void> {
		try {
			await this.executeImpl(req, res);
		} catch (error) {
			console.log(error);
			this.fail(res, error);
		}
	}

	protected abstract async executeImpl(
		req: e.Request,
		res: e.Response
	): Promise<void>;

	public static jsonResponse(
		res: e.Response,
		statusCode: number,
		payload?: unknown
	): void {
		res.status(statusCode).json(payload || HTTPStatus.getStatusText(statusCode));
	}

	public static jsonErrorResponse(
		res: e.Response,
		statusCode: number,
		errorCode?: string
	): void;
	public static jsonErrorResponse(
		res: e.Response,
		statusCode: number,
		errorCode: string,
		error: unknown
	): void;
	public static jsonErrorResponse(
		res: e.Response,
		statusCode: number,
		errorCode?: string,
		error?: unknown
	): void {
		const responsePayload: ErrorResponse = {
			error_code: errorCode || HTTPStatus.getStatusText(statusCode)
		};
		if (error) responsePayload.error = error;
		res.status(statusCode).json(responsePayload);
	}

	public ok(res: e.Response, data?: unknown): void {
		BaseController.jsonResponse(res, 200, data);
	}

	public created(res: e.Response, creation?: unknown): void {
		BaseController.jsonResponse(res, 201, creation);
	}

	public badRequest(res: e.Response, errorCode?: string): void {
		BaseController.jsonErrorResponse(res, 400, errorCode);
	}

	public missingAuthorizationToken(res: e.Response, errorCode?: string): void {
		BaseController.jsonErrorResponse(
			res,
			401,
			errorCode || 'Missing Authorization Bearer Token'
		);
	}

	public missingParams(res: e.Response, param: string): void;
	public missingParams(res: e.Response, params: string[]): void;
	public missingParams(res: e.Response, p: string | string[]): void {
		const error = {
			missing_parameters: Array.isArray(p) ? p : [p]
		};
		BaseController.jsonErrorResponse(
			res,
			400,
			'Missing Required Parameters',
			error
		);
	}

	public unauthorized(res: e.Response, errorCode?: string): void {
		BaseController.jsonErrorResponse(res, 401, errorCode);
	}

	public forbidden(res: e.Response, errorCode?: string): void {
		BaseController.jsonResponse(res, 403, errorCode);
	}

	public notFound(res: e.Response, errorCode?: string): void {
		BaseController.jsonErrorResponse(res, 404, errorCode);
	}

	public fail(res: e.Response, error: Error): void {
		BaseController.jsonErrorResponse(
			res,
			500,
			HTTPStatus.getStatusText(500),
			error.toString()
		);
	}
}
