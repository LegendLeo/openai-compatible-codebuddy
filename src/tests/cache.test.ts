/**
 * LRU Cache Unit Tests
 *
 * Run: npm test
 */
import { LRUCache } from '../services/cache.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, name: string) {
  const ok = actual === expected;
  if (!ok) {
    console.log(`  ✗ ${name} (expected ${expected}, got ${actual})`);
    failed++;
  } else {
    console.log(`  ✓ ${name}`);
    passed++;
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ Tests ============

console.log('\n🧪 LRU Cache Unit Tests\n');

// --- Test 1: Basic get/set ---
console.log('▸ Basic get/set');
{
  const cache = new LRUCache<string>(10, 60_000);
  cache.set('key1', 'value1');
  assertEqual(cache.get('key1'), 'value1', 'get returns stored value');
  assertEqual(cache.get('nonexistent'), undefined, 'get returns undefined for missing key');
}

// --- Test 2: Cache hit/miss tracking ---
console.log('\n▸ Hit/miss tracking');
{
  const cache = new LRUCache<string>(10, 60_000);
  cache.set('a', '1');
  cache.get('a');         // hit
  cache.get('a');         // hit
  cache.get('missing');   // miss
  assertEqual(cache.stats.hits, 2, 'hits count is 2');
  assertEqual(cache.stats.misses, 1, 'misses count is 1');
  assert(Math.abs(cache.stats.hitRate - 2 / 3) < 0.001, 'hitRate is ~0.667');
}

// --- Test 3: LRU eviction ---
console.log('\n▸ LRU eviction');
{
  const cache = new LRUCache<string>(3, 60_000);
  cache.set('a', '1');
  cache.set('b', '2');
  cache.set('c', '3');

  // Access 'a' to make it most recently used
  cache.get('a');

  // Add 'd' — should evict 'b' (least recently used)
  cache.set('d', '4');

  assertEqual(cache.get('a'), '1', 'a is still present (recently accessed)');
  assertEqual(cache.get('b'), undefined, 'b was evicted (LRU)');
  assertEqual(cache.get('c'), '3', 'c is still present');
  assertEqual(cache.get('d'), '4', 'd is present');
  assertEqual(cache.stats.size, 3, 'size stays at maxSize=3');
}

// --- Test 4: TTL expiration ---
console.log('\n▸ TTL expiration');
{
  const cache = new LRUCache<string>(10, 100); // 100ms TTL
  cache.set('expire-me', 'value');
  assertEqual(cache.get('expire-me'), 'value', 'value present before TTL');

  await sleep(150);

  assertEqual(cache.get('expire-me'), undefined, 'value expired after TTL');
  assert(cache.has('expire-me') === false, 'has() returns false after TTL');
}

// --- Test 5: Overwrite existing key ---
console.log('\n▸ Overwrite existing key');
{
  const cache = new LRUCache<string>(10, 60_000);
  cache.set('key', 'old');
  cache.set('key', 'new');
  assertEqual(cache.get('key'), 'new', 'overwritten value is returned');
  assertEqual(cache.stats.size, 1, 'size remains 1 after overwrite');
}

// --- Test 6: Clear ---
console.log('\n▸ Clear');
{
  const cache = new LRUCache<string>(10, 60_000);
  cache.set('a', '1');
  cache.set('b', '2');
  cache.get('a');
  cache.clear();
  assertEqual(cache.stats.size, 0, 'size is 0 after clear');
  assertEqual(cache.stats.hits, 0, 'hits reset after clear');
  assertEqual(cache.stats.misses, 0, 'misses reset after clear');
  assertEqual(cache.get('a'), undefined, 'values cleared');
}

// --- Test 7: generateKey determinism ---
console.log('\n▸ generateKey determinism');
{
  const params1 = { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] };
  const params2 = { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4' }; // different order
  const params3 = { model: 'gpt-4', messages: [{ role: 'user', content: 'hello' }] };

  const key1 = LRUCache.generateKey(params1);
  const key2 = LRUCache.generateKey(params2);
  const key3 = LRUCache.generateKey(params3);

  assertEqual(key1, key2, 'same params in different order produce same key');
  assert(key1 !== key3, 'different params produce different keys');
  assert(key1.length === 64, 'key is a 64-char SHA-256 hex');
}

// --- Test 8: has() method ---
console.log('\n▸ has() method');
{
  const cache = new LRUCache<string>(10, 60_000);
  cache.set('exists', 'yes');
  assert(cache.has('exists') === true, 'has() returns true for existing key');
  assert(cache.has('nope') === false, 'has() returns false for missing key');
}

// --- Test 9: Complex value types ---
console.log('\n▸ Complex value types');
{
  interface ResponseObj {
    id: string;
    choices: Array<{ text: string }>;
  }
  const cache = new LRUCache<ResponseObj>(10, 60_000);
  const response: ResponseObj = { id: 'chatcmpl-123', choices: [{ text: 'hello' }] };
  cache.set('resp', response);
  const retrieved = cache.get('resp');
  assertEqual(retrieved?.id, 'chatcmpl-123', 'complex object retrieved correctly');
  assertEqual(retrieved?.choices[0].text, 'hello', 'nested data intact');
}

// --- Test 10: Stats when empty ---
console.log('\n▸ Stats when empty');
{
  const cache = new LRUCache<string>(10, 60_000);
  assertEqual(cache.stats.hitRate, 0, 'hitRate is 0 when no operations');
  assertEqual(cache.stats.size, 0, 'size is 0 for new cache');
}

// ============ Summary ============
console.log(`\n${'═'.repeat(40)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}\n`);

if (failed > 0) {
  process.exit(1);
}
