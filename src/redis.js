import { createClient } from 'redis';
import dotenv from 'dotenv';
dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redisClient = createClient({
  url: redisUrl
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

let pubClient;

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log('Connected to Redis');
  }
};

export const getRedisClient = () => redisClient;

export const getPubClient = async () => {
  if (!pubClient) {
    pubClient = redisClient.duplicate();
    await pubClient.connect();
    console.log('Pub client connected');
  }
  return pubClient;
};
