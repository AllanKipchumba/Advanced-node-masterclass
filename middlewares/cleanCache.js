const { clearHash } = require('../services/cache');

module.exports = async (req, res, next) => {
  // allow route handler to run first
  await next();

  //clear cache
  clearHash(req.user.id);
};
