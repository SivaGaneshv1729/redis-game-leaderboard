import { Router } from 'express';
import { getRedisClient, getPubClient } from './redis.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const router = Router();

const __dirname = path.resolve();

// Load Lua scripts
const invalidateSessionsScript = fs.readFileSync(path.join(__dirname, 'src', 'scripts', 'invalidate_sessions.lua'), 'utf-8');
const submitAnswerScript = fs.readFileSync(path.join(__dirname, 'src', 'scripts', 'submit_answer.lua'), 'utf-8');

// POST /api/sessions
router.post('/sessions', async (req, res) => {
  try {
    const { userId, ipAddress, deviceType } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const client = getRedisClient();
    const sessionId = crypto.randomUUID();
    
    // Atomically invalidate old sessions
    await client.eval(invalidateSessionsScript, {
      keys: [`user_sessions:${userId}`],
      arguments: [sessionId]
    });

    const now = new Date().toISOString();
    
    // Create new session Hash with 30-minute expiration
    const sessionKey = `session:${sessionId}`;
    await client.hSet(sessionKey, {
      userId,
      createdAt: now,
      lastActive: now,
      ipAddress: ipAddress || '',
      deviceType: deviceType || ''
    });
    await client.expire(sessionKey, 1800); // 30 minutes

    res.status(201).json({ sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/leaderboard/scores
router.post('/leaderboard/scores', async (req, res) => {
  try {
    const { playerId, points } = req.body;
    if (!playerId || points === undefined) return res.status(400).json({ error: 'playerId and points are required' });

    const client = getRedisClient();
    const newScore = await client.zIncrBy('leaderboard:global', points, playerId);

    // Publish event
    await client.publish('game-events', JSON.stringify({
      event: 'leaderboard_updated',
      data: { playerId, newScore: parseFloat(newScore) }
    }));

    res.status(200).json({ playerId, newScore: parseFloat(newScore) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/leaderboard/top/:count
router.get('/leaderboard/top/:count', async (req, res) => {
  try {
    const count = parseInt(req.params.count) || 10;
    const client = getRedisClient();
    
    const results = await client.zRangeWithScores('leaderboard:global', 0, count - 1, { REV: true });
    
    const topPlayers = results.map((result, index) => ({
      rank: index + 1,
      playerId: result.value,
      score: result.score
    }));

    res.status(200).json(topPlayers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/leaderboard/player/:playerId
router.get('/leaderboard/player/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const client = getRedisClient();

    const rank = await client.zRevRank('leaderboard:global', playerId);
    if (rank === null) return res.status(404).json({ error: 'Player not found' });
    
    const score = await client.zScore('leaderboard:global', playerId);
    const totalPlayers = await client.zCard('leaderboard:global');
    
    const percentile = totalPlayers > 1 ? ((totalPlayers - rank - 1) / (totalPlayers - 1)) * 100 : 100;

    // Get nearby players (2 above, 2 below)
    const aboveStart = Math.max(0, rank - 2);
    const aboveEnd = Math.max(0, rank - 1);
    
    let above = [];
    if (rank > 0) {
        const aboveResults = await client.zRangeWithScores('leaderboard:global', aboveStart, aboveEnd, { REV: true });
        above = aboveResults.map((result, idx) => ({
            rank: aboveStart + idx + 1,
            playerId: result.value,
            score: result.score
        }));
    }

    const belowStart = rank + 1;
    const belowEnd = rank + 2;
    let below = [];
    if (belowStart < totalPlayers) {
        const belowResults = await client.zRangeWithScores('leaderboard:global', belowStart, belowEnd, { REV: true });
        below = belowResults.map((result, idx) => ({
            rank: belowStart + idx + 1,
            playerId: result.value,
            score: result.score
        }));
    }

    res.status(200).json({
      playerId,
      score: parseFloat(score),
      rank: rank + 1,
      percentile: parseFloat(percentile.toFixed(2)),
      nearbyPlayers: {
        above,
        below
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/game/submit
router.post('/game/submit', async (req, res) => {
  try {
    const { gameId, roundId, playerId, answer } = req.body;
    if (!gameId || !roundId || !playerId || !answer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = getRedisClient();
    const currentTime = Date.now();
    const pointsToAdd = 10; // For instance

    const result = await client.eval(submitAnswerScript, {
      keys: [`game_round:${gameId}:${roundId}`, `submissions:${gameId}:${roundId}`, 'leaderboard:global'],
      arguments: [playerId, currentTime.toString(), pointsToAdd.toString()]
    });

    const parsedResult = JSON.parse(result);

    if (parsedResult.status === 'ERROR') {
      const statusCode = parsedResult.code === 'DUPLICATE_SUBMISSION' ? 400 : 403;
      return res.status(statusCode).json(parsedResult);
    }

    // Publish event for score update
    await client.publish('game-events', JSON.stringify({
      event: 'leaderboard_updated',
      data: { playerId, newScore: parsedResult.newScore }
    }));

    res.status(200).json(parsedResult);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/events (SSE)
router.get('/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const pubClient = await getPubClient();
  
  const listener = (message, channel) => {
    if (channel === 'game-events') {
      try {
        const parsed = JSON.parse(message);
        res.write(`event: ${parsed.event}\n`);
        res.write(`data: ${JSON.stringify(parsed.data)}\n\n`);
      } catch (err) {
        console.error('Error parsing event message', err);
      }
    }
  };

  pubClient.subscribe('game-events', listener);

  req.on('close', () => {
    pubClient.unsubscribe('game-events', listener);
  });
});

// GET /api/admin/sessions/user/:userId
router.get('/admin/sessions/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const client = getRedisClient();
    
    const sessionIds = await client.sMembers(`user_sessions:${userId}`);
    const sessions = [];

    for (const id of sessionIds) {
      const data = await client.hGetAll(`session:${id}`);
      if (Object.keys(data).length > 0) {
        sessions.push({
          sessionId: id,
          ...data
        });
      } else {
        // Cleanup orphaned session ID in set
        await client.sRem(`user_sessions:${userId}`, id);
      }
    }

    res.status(200).json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE /api/admin/sessions/:sessionId
router.delete('/admin/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const client = getRedisClient();
    
    const sessionData = await client.hGetAll(`session:${sessionId}`);
    if (Object.keys(sessionData).length > 0) {
      const userId = sessionData.userId;
      await client.del(`session:${sessionId}`);
      if (userId) {
        await client.sRem(`user_sessions:${userId}`, sessionId);
      }
    }
    
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
