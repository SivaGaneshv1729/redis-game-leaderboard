-- KEYS[1] = user_sessions:{userId}
-- ARGV[1] = newSessionId

local oldSessions = redis.call('SMEMBERS', KEYS[1])
for i, sessionId in ipairs(oldSessions) do
  redis.call('DEL', 'session:' .. sessionId)
end

redis.call('DEL', KEYS[1])
redis.call('SADD', KEYS[1], ARGV[1])

return 1
