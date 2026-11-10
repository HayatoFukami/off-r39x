-- Shared rate limit evaluation: one atomic sliding window log evaluation of all rules of a request
-- (SPEC-140 SEC-ABU-012 / 013 / 014 / 016). Source controlled and invoked by script hash (DEV-RLM-003).
--
-- KEYS[i]   counter key of rule i (a sorted set: member = request id, score = store time in ms)
-- ARGV[1]   mode: admit | check | record
-- ARGV[2]   member id for this request (unique per evaluation)
-- ARGV[2*i+1], ARGV[2*i+2]   limit and window in ms of rule i
--
-- Returns { allowed, exceeded_1, retry_after_ms_1, exceeded_2, retry_after_ms_2, ... }.
--
-- Time is read from the store (SEC-ABU-014). The read phase never writes. An admit that finds
-- any exceeded rule returns without writing anything, so a rejection consumes no counter. The
-- first write of the write phase is a ZADD, so a store that is out of memory (noeviction) refuses
-- the whole evaluation before any key changed (SEC-ABU-019).
local mode = ARGV[1]
local member = ARGV[2]
if mode ~= 'admit' and mode ~= 'check' and mode ~= 'record' then
  return redis.error_reply('ERR unsupported mode')
end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

local result = { 1 }
local allowed = true
local rules = #KEYS
local windows = {}
for i = 1, rules do
  local limit = tonumber(ARGV[1 + 2 * i])
  local window = tonumber(ARGV[2 + 2 * i])
  if limit == nil or window == nil or limit < 1 or window < 1 then
    return redis.error_reply('ERR invalid rule')
  end
  windows[i] = window
  local lower = '(' .. string.format('%d', now - window)
  local count = redis.call('ZCOUNT', KEYS[i], lower, '+inf')
  local exceeded = 0
  local retry = 0
  if mode ~= 'record' and count >= limit then
    -- The (count - limit + 1)-th oldest live entry must leave the window before one more fits.
    local pivot = redis.call('ZRANGEBYSCORE', KEYS[i], lower, '+inf', 'WITHSCORES', 'LIMIT', count - limit, 1)
    exceeded = 1
    allowed = false
    retry = math.max(1, math.floor(tonumber(pivot[2]) + window - now))
  end
  result[2 * i] = exceeded
  result[2 * i + 1] = retry
end

if mode == 'check' or (mode == 'admit' and not allowed) then
  result[1] = allowed and 1 or 0
  return result
end

for i = 1, rules do
  redis.call('ZADD', KEYS[i], now, member)
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - windows[i])
  -- The TTL is at least the rule window (SEC-ABU-016); a key never lives without one.
  redis.call('PEXPIRE', KEYS[i], windows[i] + 1000)
end
result[1] = 1
return result
