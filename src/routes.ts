import * as e from 'express';
import GoogleSignInController from './controllers/GoogleSignInController';
import GoogleCallbackController from './controllers/GoogleCallbackController';
import SignInController from './controllers/SignInController';
import AuthorizeController from './controllers/AuthorizeController';
import RefreshController from './controllers/RefreshController';
import SignOutController from './controllers/SignOutController';
import SignOutAllDevicesController from './controllers/SignOutAllDevicesController';

const router: e.Router = e.Router();

router.get('/google/sign-in', (req: e.Request, res: e.Response) =>
	new GoogleSignInController().execute(req, res)
);

router.get('/google/callback', (req: e.Request, res: e.Response) =>
	new GoogleCallbackController().execute(req, res)
);

router.post('/sign-in', (req: e.Request, res: e.Response) =>
	new SignInController().execute(req, res)
);

router.get('/authorize', (req: e.Request, res: e.Response) =>
	new AuthorizeController().execute(req, res)
);

router.get('/refresh', (req: e.Request, res: e.Response) =>
	new RefreshController().execute(req, res)
);

router.post('/sign-out', (req: e.Request, res: e.Response) =>
	new SignOutController().execute(req, res)
);

router.post('/sign-out-all-devices', (req: e.Request, res: e.Response) =>
	new SignOutAllDevicesController().execute(req, res)
);

export default router;
