const redis = require("redis");

class RedisCacheManager {
    constructor(redisCacheOpts) {
        this.redisClient = 
            redis.createClient(redisCacheOpts);
    }

    get client() {
        return this.redisClient;
    }

    setKey(key, payload, secs) {
        return new Promise((resolve) => {
            this.redisClient.set(
                key, 
                JSON.stringify(payload), 
                'EX', 
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
            this.redisClient.del(key, n => {
                resolve(n);
            })
        });
    }
}

module.exports = RedisCacheManager;