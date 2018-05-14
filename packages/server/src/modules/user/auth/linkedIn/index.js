import { pick } from 'lodash';
import passport from 'passport';
import { Strategy as LinkedInStrategy } from 'passport-linkedin-oauth2';

import resolvers from './resolvers';
import Feature from '../connector';
import UserDAO from '../../sql';
import settings from '../../../../../../../settings';
import access from '../../access';

let middleware;

if (settings.user.auth.linkedin.enabled && !__TEST__) {
  const User = new UserDAO();

  passport.use(
    new LinkedInStrategy(
      {
        clientID: settings.user.auth.linkedin.clientID,
        clientSecret: settings.user.auth.linkedin.clientSecret,
        callbackURL: '/auth/linkedin/callback',
        scope: settings.user.auth.linkedin.scope
      },
      async function(accessToken, refreshToken, profile, cb) {
        const {
          id,
          username,
          displayName,
          emails: [{ value }]
        } = profile;
        try {
          let user = await User.getUserByLnInIdOrEmail(id, value);

          if (!user) {
            const isActive = true;
            const [createdUserId] = await User.register({
              username: username ? username : displayName,
              email: value,
              password: id,
              isActive
            });

            await User.createLinkedInAuth({
              id,
              displayName,
              userId: createdUserId
            });

            user = await User.getUser(createdUserId);
          } else if (!user.lnId) {
            await User.createLinkedInAuth({
              id,
              displayName,
              userId: user.id
            });
          }
          return cb(null, pick(user, ['id', 'username', 'role', 'email']));
        } catch (err) {
          return cb(err, {});
        }
      }
    )
  );

  middleware = app => {
    app.use(passport.initialize());
    app.get('/auth/linkedin', (req, res, next) => {
      passport.authenticate('linkedin', { state: req.query.expoUrl })(req, res, next);
    });
    app.get(
      '/auth/linkedin/callback',
      passport.authenticate('linkedin', { session: false, failureRedirect: '/login' }),
      async function(req, res) {
        const user = await User.getUserWithPassword(req.user.id);
        const redirectUrl = req.query.state;
        const tokens = await access.grantAccess(user, req);

        if (redirectUrl) {
          res.redirect(
            redirectUrl +
              (tokens
                ? '?data=' +
                  JSON.stringify({
                    tokens
                  })
                : '')
          );
        } else {
          res.redirect('/profile');
        }
      }
    );
  };
}

export default new Feature({ middleware, createResolversFunc: resolvers });