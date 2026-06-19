import express from 'express';
import dotenv from 'dotenv';
import { connectRedis, getRedisClient } from './redis.js';
import { router } from './routes.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    const client = getRedisClient();
    if (client.isOpen) {
      await client.ping();
      res.status(200).send('OK');
    } else {
      res.status(500).send('Redis not connected');
    }
  } catch (error) {
    res.status(500).send('Error');
  }
});

app.use('/api', router);

const startServer = async () => {
  try {
    await connectRedis();
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
  }
};

startServer();
