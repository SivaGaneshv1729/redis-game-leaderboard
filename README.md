# Cosmic Protocol: Redis Game Leaderboard

A high-performance, real-time backend and dashboard for a competitive game platform. This project leverages the raw speed and atomic capabilities of Redis to manage user sessions, process game submissions, and broadcast live leaderboard events.

## Features

- **Real-Time Leaderboard**: Built on top of Redis Sorted Sets (`ZADD`, `ZINCRBY`) to handle thousands of concurrent score updates with `O(log(N))` efficiency.
- **Atomic Session Management**: Uses Lua scripts to safely create and automatically invalidate duplicate user sessions without race conditions.
- **Atomic Game Logic**: Game submissions are validated (checking active rounds and duplicate answers) and recorded in a single atomic Redis transaction.
- **Live Event Broadcasting**: A combination of Redis Pub/Sub and Server-Sent Events (SSE) pushes score updates instantly to all connected clients.
- **Cyberpunk Dashboard**: A premium, responsive frontend built with a cyberpunk/hacker aesthetic to visualize the live leaderboard and data streams.
- **Fully Containerized**: Runs seamlessly out of the box using Docker and Docker Compose.

## Tech Stack

- **Backend**: Node.js, Express.js
- **Data Store**: Redis (redis:7-alpine)
- **Containerization**: Docker & Docker Compose
- **Frontend**: Vanilla HTML/CSS/JS (Server-Sent Events)

## Getting Started

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose installed on your machine.

### Installation & Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/SivaGaneshv1729/redis-game-leaderboard.git
   cd redis-game-leaderboard
   ```

2. **Environment Variables**
   The project comes with a `.env.example` file. The Docker setup automatically configures these values, but you can copy them if running locally outside Docker.
   ```bash
   cp .env.example .env
   ```

3. **Spin up the containers**
   ```bash
   docker-compose up -d --build
   ```

4. **Access the Application**
   - **Live Dashboard**: Navigate to `http://localhost:3000`
   - **Health Check**: `http://localhost:3000/health`

## API Endpoints

### Sessions

#### `POST /api/sessions`
Create a new session. Atomically invalidates any old sessions for the user using Lua scripts.
- **Body**: `{ "userId": "string", "ipAddress": "string" (optional), "deviceType": "string" (optional) }`
- **Response**: `201 Created` with `{ "sessionId": "uuid" }`

#### `GET /api/admin/sessions/user/:userId`
View all active sessions for a user.
- **Response**: `200 OK` with `[ { "sessionId": "uuid", "userId": "string", "createdAt": "iso-date", "lastActive": "iso-date", "ipAddress": "string", "deviceType": "string" } ]`

#### `DELETE /api/admin/sessions/:sessionId`
Forcefully terminate a specific session.
- **Response**: `204 No Content`

### Game Logic & Leaderboard

#### `POST /api/game/submit`
Process a player's answer and update their score. Uses an atomic Redis transaction to validate against duplicate submissions and active rounds.
- **Body**: `{ "gameId": "string", "roundId": "string", "playerId": "string", "answer": "string" }`
- **Response**: 
  - `200 OK`: `{ "status": "SUCCESS", "newScore": 125 }`
  - `400 Bad Request`: `{ "status": "ERROR", "code": "DUPLICATE_SUBMISSION" }`
  - `403 Forbidden`: `{ "status": "ERROR", "code": "ROUND_EXPIRED" }`

#### `POST /api/leaderboard/scores`
Directly update a player's score.
- **Body**: `{ "playerId": "string", "points": number }`
- **Response**: `200 OK` with `{ "playerId": "string", "newScore": number }`

#### `GET /api/leaderboard/top/:count`
Fetch the top `N` players.
- **Response**: `200 OK` with `[ { "rank": 1, "playerId": "string", "score": 150 } ]`

#### `GET /api/leaderboard/player/:playerId`
Get a specific player's rank, score, percentile, and nearby players on the leaderboard.
- **Response**: `200 OK` with 
```json
{
  "playerId": "string",
  "score": 125,
  "rank": 2,
  "percentile": 95.5,
  "nearbyPlayers": {
    "above": [ { "rank": 1, "playerId": "string", "score": 150 } ],
    "below": [ { "rank": 3, "playerId": "string", "score": 110 } ]
  }
}
```

### Real-Time Events

#### `GET /api/events`
Server-Sent Events (SSE) endpoint. Connect to receive live data when the leaderboard updates.
- **Event**: `leaderboard_updated`
- **Data Payload**: `{ "playerId": "string", "newScore": number }`

## Memory Analysis

A detailed breakdown of Redis memory usage (comparing Hashes vs. Sorted Sets, and Ziplist vs. Skiplist encodings) can be found in the [MEMORY_ANALYSIS.md](./MEMORY_ANALYSIS.md) file.

## Testing

An end-to-end testing script (`test.js`) is included to verify the endpoints.
```bash
# Run the test script
node test.js
```
