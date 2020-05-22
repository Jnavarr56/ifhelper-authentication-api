const redis = require("redis");

class RedisCacheManager {
	constructor(redisCacheOpts) {
		if (!redisCacheOpts.prefix) {
			throw new Error("Prefix Required");
		}

		this.opts = redisCacheOpts;
		this.redisClient = redis.createClient(redisCacheOpts);
	}

	get client() {
		return this.redisClient;
	}

	setKey(key, payload, secs) {
		return new Promise((resolve) => {
			this.redisClient.set(
				key,
				JSON.stringify(payload),
				"EX",
				secs,
				(cacheError, status) => resolve({ cacheError, status })
			);
		});
	}

	getKey(key) {
		return new Promise((resolve) => {
			this.redisClient.get(key, (cacheError, cachedVal) => {
				resolve({ cacheError, cachedVal: JSON.parse(cachedVal) });
			});
		});
	}

	deleteKey(key) {
		return new Promise((resolve) => {
			this.redisClient.del(key, (err, n) => resolve(n));
		});
	}

	deleteAllKeys() {
		return new Promise((resolve) => {
			this.redisClient.keys(this.opts.prefix + "*", (err, rows) => {
				this.redisClient.del(
					rows.map((row) => row.replace(this.opts.prefix, "")),
					(err, n) => resolve(n)
				);
			});
		});
	}
}

module.exports = RedisCacheManager;
