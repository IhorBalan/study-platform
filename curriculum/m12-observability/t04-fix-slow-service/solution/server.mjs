// The product service. Product pages are cached after the first render, and each
// page links to related products from the same category.
import http from 'node:http';
import { describe, loadCatalogue } from './catalogue.mjs';

const catalogue = loadCatalogue();
const byId = new Map(catalogue.map((product) => [product.id, product]));

function byRatingThenName(a, b) {
  return b.rating - a.rating || a.name.localeCompare(b.name) || a.id - b.id;
}

// Fix 1: the ranking does not depend on the request, so sort once at start-up
// (about 200 ms, once) instead of on every request (about 200 ms of blocked event loop, every time).
const rankedByCategory = new Map();
for (const product of catalogue.slice().sort(byRatingThenName)) {
  const list = rankedByCategory.get(product.category) ?? [];
  list.push(product);
  rankedByCategory.set(product.category, list);
}

/** The five best-rated other products in the same category. */
function relatedProducts(product) {
  const related = [];
  for (const other of rankedByCategory.get(product.category) ?? []) {
    if (other.id === product.id) continue;
    related.push({ id: other.id, name: other.name, rating: other.rating });
    if (related.length === 5) break;
  }
  return related;
}

/**
 * Fix 2: a cache needs a bound. A Map keeps insertion order, so the first key is the
 * least recently used once every hit moves its key to the end.
 */
class LruCache {
  #entries = new Map();
  constructor(max) {
    this.max = max;
  }
  get(key) {
    const value = this.#entries.get(key);
    if (value !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, value);
    }
    return value;
  }
  set(key, value) {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    if (this.#entries.size > this.max) this.#entries.delete(this.#entries.keys().next().value);
  }
  get size() {
    return this.#entries.size;
  }
}

// Keyed by product id, not by req.url: "?utm_source=x" must not create a new entry.
// 500 pages of about 30 kB is about 15 MB at most.
const pageCache = new LruCache(500);

function productPage(product) {
  let body = pageCache.get(product.id);
  if (body === undefined) {
    body = JSON.stringify({ ...product, description: describe(product) });
    pageCache.set(product.id, body);
  }
  return body;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    if (url.pathname === '/health') return send(res, 200, { status: 'ok' });

    const match = /^\/products\/(\d+)(\/related)?$/.exec(url.pathname);
    const product = match ? byId.get(Number(match[1])) : undefined;
    if (!product) return send(res, 404, { error: 'not found' });

    if (match[2]) return send(res, 200, { id: product.id, related: relatedProducts(product) });
    return send(res, 200, productPage(product));
  });
}
