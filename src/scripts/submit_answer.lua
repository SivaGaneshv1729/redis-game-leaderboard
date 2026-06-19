-- KEYS[1] = game_round:{gameId}:{roundId}
-- KEYS[2] = submissions:{gameId}:{roundId}
-- KEYS[3] = leaderboard:global
-- ARGV[1] = playerId
-- ARGV[2] = currentTime
-- ARGV[3] = pointsToAdd

local roundData = redis.call('HMGET', KEYS[1], 'endTime')
local endTime = roundData[1]

if not endTime or tonumber(ARGV[2]) > tonumber(endTime) then
  return '{"status":"ERROR","code":"ROUND_EXPIRED"}'
end

local isMember = redis.call('SISMEMBER', KEYS[2], ARGV[1])
if isMember == 1 then
  return '{"status":"ERROR","code":"DUPLICATE_SUBMISSION"}'
end

redis.call('SADD', KEYS[2], ARGV[1])
local newScore = redis.call('ZINCRBY', KEYS[3], tonumber(ARGV[3]), ARGV[1])

return '{"status":"SUCCESS","newScore":' .. tostring(newScore) .. '}'
