
const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/orders/batch',
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json'
    }
};

console.log(`Testing PUT http://${options.hostname}:${options.port}${options.path}...`);

const req = http.request(options, (res) => {
    console.log(`Status: ${res.status}`);
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('Response:', data);
    });
});

req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
});

req.write(JSON.stringify({ orders: [] }));
req.end();
