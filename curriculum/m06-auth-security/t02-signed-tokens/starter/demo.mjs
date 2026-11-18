// Try your module: `node demo.mjs`
import { issueToken, verifyToken } from './token.mjs';

const secret = 'demo-secret-change-me-0123456789abcdef';
const token = issueToken({ sub: 'user-1', role: 'member' }, { secret, expiresInSeconds: 900, audience: 'api' });
console.log('token:', token);
console.log('verified:', verifyToken(token, { secret, audience: 'api' }));

// Promote yourself and keep the old signature.
const [header, payload, signature] = token.split('.');
const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
const promoted = Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url');
try {
  console.log('tampered token accepted:', verifyToken(`${header}.${promoted}.${signature}`, { secret, audience: 'api' }));
} catch (error) {
  console.log('tampered token refused:', error.code);
}
