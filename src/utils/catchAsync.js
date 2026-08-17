/**
 * Wraps an async route handler so a rejected promise is forwarded to Express'
 * error middleware instead of hanging the request. Express 4 does not catch
 * async rejections on its own.
 *
 *   router.get('/', catchAsync(async (req, res) => { ... }));
 */
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
