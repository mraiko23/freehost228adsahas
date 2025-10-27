// Poller suitable for Render web service
// It runs the same detection loop (poll STOCK_API_URL) but also binds to the PORT
// so Render can detect the service. Background work keeps running while server answers health checks.

const fetch = require('node-fetch');
const http = require('http');

const WORKER_URL = process.env.WORKER_URL || 'https://proud-star-083b.karovakorovnin.workers.dev';
const STOCK_API_URL = process.env.STOCK_API_URL || 'https://plantsvsbrainrotsstocktracker.com/api/stock?since=0';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS, 10) || 2000; // 2 seconds default
const PORT = parseInt(process.env.PORT, 10) || 3000;

let lastUpdatedAt = null;
let inFlight = false;

async function fetchStockOnce() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch(STOCK_API_URL);
    if (!res.ok) {
      console.warn(new Date().toISOString(), 'stock api returned', res.status);
      return;
    }
    const data = await res.json();
    const updatedAt = data && data.updatedAt ? Number(data.updatedAt) : null;

    if (updatedAt && lastUpdatedAt && updatedAt !== lastUpdatedAt) {
      console.log(new Date().toISOString(), 'Detected updatedAt change:', lastUpdatedAt, '->', updatedAt);
      // call worker /force-check to trigger notification logic
      try {
        const r = await fetch(`${WORKER_URL}/force-check`);
        console.log(new Date().toISOString(), '/force-check status:', r.status);
      } catch (err) {
        console.error(new Date().toISOString(), 'Error calling /force-check:', err && err.message ? err.message : err);
      }
    }

    if (updatedAt && lastUpdatedAt === null) {
      console.log(new Date().toISOString(), 'Initial updatedAt set to', updatedAt);
    }
    if (updatedAt) lastUpdatedAt = updatedAt;
  } catch (err) {
    console.error(new Date().toISOString(), 'Error fetching stock API:', err && err.message ? err.message : err);
  } finally {
    inFlight = false;
  }
}

// Start background polling
fetchStockOnce();
const intervalHandle = setInterval(fetchStockOnce, INTERVAL_MS);

// Create simple HTTP server so Render can detect the service on the bound PORT
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Poller running');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Poller HTTP server listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received: shutting down');
  clearInterval(intervalHandle);
  server.close(() => process.exit(0));
});



