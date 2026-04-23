import jwt from 'jsonwebtoken';

const token = jwt.sign(
  { id: '123', email: 'test@test.com', role: 'ADMIN' },
  'your-super-secret-jwt-key-change-this-in-production-use-crypto-random',
  { expiresIn: '1h' }
);

async function run() {
  const res = await fetch('http://localhost:3000/api/clients?limit=5000', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await res.text();
  console.log('STATUS:', res.status);
  console.log('RESPONSE LENGHT:', text.length);
}

run();
