const http = require('http');

const data = JSON.stringify({ rawText: 'test', categoryList: 'Test' });

const req = http.request({
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/v1/scan-bill',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log(res.statusCode, body));
});

req.on('error', console.error);
req.write(data);
req.end();
