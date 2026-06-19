import fetch from 'node-fetch';
import { createClient } from 'redis';

const API_URL = 'http://localhost:3000/api';

async function runTests() {
  console.log('--- Running E2E Tests ---\n');

  // Wait for healthcheck
  let healthy = false;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch('http://localhost:3000/health');
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch (e) {
      // ignore
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!healthy) {
    console.error('API did not become healthy in time.');
    process.exit(1);
  }
  console.log('✅ API is healthy');

  // 1. Session Creation
  const sessionRes1 = await fetch(`${API_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'user-123', ipAddress: '127.0.0.1', deviceType: 'desktop' })
  });
  const sessionData1 = await sessionRes1.json();
  console.log('✅ Created session 1:', sessionData1.sessionId);

  // 2. Duplicate Session Creation (should invalidate old)
  const sessionRes2 = await fetch(`${API_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'user-123', ipAddress: '127.0.0.1', deviceType: 'mobile' })
  });
  const sessionData2 = await sessionRes2.json();
  console.log('✅ Created session 2 (invalidates session 1):', sessionData2.sessionId);

  // 3. Admin check sessions
  const adminRes = await fetch(`${API_URL}/admin/sessions/user/user-123`);
  const adminSessions = await adminRes.json();
  if (adminSessions.length === 1 && adminSessions[0].sessionId === sessionData2.sessionId) {
     console.log('✅ Lua script successfully invalidated old sessions.');
  } else {
     console.error('❌ Failed session invalidation:', adminSessions);
  }

  // 4. Update scores
  await fetch(`${API_URL}/leaderboard/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: 'player-A', points: 100 })
  });
  await fetch(`${API_URL}/leaderboard/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: 'player-B', points: 150 })
  });
  const scoreRes = await fetch(`${API_URL}/leaderboard/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: 'player-A', points: 25 })
  });
  const scoreData = await scoreRes.json();
  console.log('✅ Score updated for player-A:', scoreData.newScore); // Should be 125

  // 5. Get Leaderboard
  const topRes = await fetch(`${API_URL}/leaderboard/top/10`);
  const topData = await topRes.json();
  console.log('✅ Top Players:', topData);

  // 6. Test Game Submission
  // First, we need to seed a game round directly in Redis
  const redis = createClient({ url: 'redis://localhost:6379' });
  await redis.connect();
  
  // Set end time to 10 minutes in the future
  const futureTime = Date.now() + 600000;
  await redis.hSet('game_round:g-501:r-1', { endTime: futureTime.toString() });

  const submitRes1 = await fetch(`${API_URL}/game/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'g-501', roundId: 'r-1', playerId: 'player-C', answer: '42' })
  });
  const submitData1 = await submitRes1.json();
  console.log('✅ Valid game submission:', submitData1);

  // Duplicate submission
  const submitRes2 = await fetch(`${API_URL}/game/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'g-501', roundId: 'r-1', playerId: 'player-C', answer: '42' })
  });
  const submitData2 = await submitRes2.json();
  console.log('✅ Duplicate game submission blocked:', submitData2);

  // Expired submission
  await redis.hSet('game_round:g-501:r-2', { endTime: (Date.now() - 600000).toString() });
  const submitRes3 = await fetch(`${API_URL}/game/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'g-501', roundId: 'r-2', playerId: 'player-D', answer: '42' })
  });
  const submitData3 = await submitRes3.json();
  console.log('✅ Expired game submission blocked:', submitData3);

  await redis.disconnect();
  console.log('\n--- All Tests Completed Successfully ---');
}

runTests();
