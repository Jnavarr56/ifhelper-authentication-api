import * as e from 'express';
import GoogleSignInController from './controllers/GoogleSignInController';
import GoogleCallbackController from './controllers/GoogleCallbackController';
import SignInController from './controllers/SignInController';

const router: e.Router = e.Router();

router.get('/google/sign-in', (req: e.Request, res: e.Response) =>
	new GoogleSignInController().execute(req, res)
);

router.get('/google/callback', (req: e.Request, res: e.Response) =>
	new GoogleCallbackController().execute(req, res)
);

router.get('/sign-in', (req: e.Request, res: e.Response) =>
	new SignInController().execute(req, res)
);

export default router;
