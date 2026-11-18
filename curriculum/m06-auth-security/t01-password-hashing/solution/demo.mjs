// Try your module: `node demo.mjs`
import { hashPassword, login, needsRehash, verifyPassword } from './password.mjs';

const started = performance.now();
const stored = await hashPassword('correct horse battery staple');
console.log('stored:', stored);
console.log(`hashing took ${Math.round(performance.now() - started)} ms`);

console.log('right password:', await verifyPassword('correct horse battery staple', stored));
console.log('wrong password:', await verifyPassword('Correct horse battery staple', stored));

const old = await hashPassword('hunter22', { N: 2 ** 14, r: 8, p: 1 });
console.log('old hash needs rehash:', needsRehash(old));
console.log('login with old hash:', await login('hunter22', old));
