# Redis Memory Analysis

## 1. Hash vs. Sorted Set Memory Usage

Redis uses different internal encodings based on the size and number of elements in its data structures to optimize for memory.

### Session Hash
A typical session Hash containing a few fields (e.g., `userId`, `createdAt`, `lastActive`, `ipAddress`, `deviceType`) is usually encoded as a `listpack` (formerly `ziplist`) when it falls below the `hash-max-listpack-entries` and `hash-max-listpack-value` thresholds. 
* **Encoding**: `listpack`
* **Memory Usage**: Extremely compact. For a session Hash with 5 fields, the memory usage is typically around 100-150 bytes.

### Large Sorted Set (100k+ players)
A Sorted Set with 100,000+ members will exceed the default listpack limits and be encoded as a `skiplist` along with a hash table.
* **Encoding**: `skiplist`
* **Memory Usage**: A skiplist provides `O(log(N))` search times but requires significantly more memory to maintain the pointers. A Sorted Set with 100k members might consume around 10-15 MB of memory depending on the length of the member strings.

## 2. Ziplist vs. Skiplist in Sorted Sets

By default, Redis optimizes small Sorted Sets using a compact, memory-efficient data structure called a `ziplist` (or `listpack` in newer versions). When a Sorted Set exceeds the configured thresholds (`zset-max-ziplist-entries` or `zset-max-ziplist-value`), it converts to a `skiplist`.

### Before Changing Threshold (Ziplist Encoding)
If we keep the number of elements below the threshold (default usually 128 elements):
```
> OBJECT ENCODING leaderboard:small
"ziplist" (or "listpack")
> MEMORY USAGE leaderboard:small
(integer) 2150
```
Memory is tightly packed, but operations like updates or inserts require reallocating memory, which makes it slower for large datasets.

### After Forcing Skiplist
By setting `config set zset-max-ziplist-entries 0`, we force Redis to use the `skiplist` encoding even for small datasets.
```
> OBJECT ENCODING leaderboard:small
"skiplist"
> MEMORY USAGE leaderboard:small
(integer) 8500
```
The memory usage increases substantially (often 3-4x more for small sets) because of the overhead of maintaining the skiplist pointers and the accompanying hash table used for `O(1)` score lookups. However, performance (`O(log N)`) is guaranteed for large sets, and updates do not require memory reallocation of the entire structure.
