//adulterate mongoose exec command - Inject some extra logic that will
//be executed before a query is sent to mongoDB
// in essence this file modifies the behavior of the exec function of
//Mongoose queries to leverage caching with Redis.

const mongoose = require('mongoose');
const redis = require('redis');
const util = require('util');

/**
 * Create a Redis client using the specified URL and promisifiy the
 * get method of the client. Promisifying allows the use of async/await
 * syntax instead of traditional callbacks.
 */
const redisUrl = 'redis://127.0.0.1:6379';
const client = redis.createClient(redisUrl);
client.hget = util.promisify(client.hget); //for nested values

//check if the query has a .cach() chained to it.
mongoose.Query.prototype.cache = function (options = {}) {
  this.useCache = true;
  this.hashKey = JSON.stringify(options.key || '');

  return this;
};

/**Store the original exec function from Mongoose in a variable and
 * override it with new asynchronous function
 */
const exec = mongoose.Query.prototype.exec;
mongoose.Query.prototype.exec = async function () {
  //only cache cachable queries
  if (!this.useCache) {
    return exec.apply(this, arguments);
  }

  /**create a unique key for Redis by combining the query conditions
   *  (this.getQuery()) and the collection name. */

  //nested key
  const key = JSON.stringify(
    Object.assign({}, this.getQuery(), {
      collection: this.mongooseCollection.name,
    })
  );

  //see if we have a value for key in redis
  const cachedValue = await client.hget(this.hashKey, key);

  //If we do, return that
  if (cachedValue) {
    //hydrate the catched data and convert it back to mongoose documents
    const doc = JSON.parse(cachedValue);

    /** this section ensures that when there is a cached value in Redis,
     *  the data is properly "hydrated" back into Mongoose documents
     *  before being returned. This helps maintain consistency and
     * compatibility with the rest of the application, which might
     * expect Mongoose model instances. */
    return Array.isArray(doc)
      ? doc.map((d) => new this.model(d))
      : new this.model(doc);
  }

  //Otherwise, issue the query and return the result in redis
  const result = await exec.apply(this, arguments);
  client.hset(this.hashKey, key, JSON.stringify(result));

  return result;
};

//delete data on redis
module.exports = {
  clearHash(hashKey) {
    client.del(JSON.stringify(hashKey));
  },
};
