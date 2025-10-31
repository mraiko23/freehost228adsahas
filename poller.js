// Poller suitable for Render web service
// It runs the same detection loop (poll STOCK_API_URL) but also binds to the PORT
// so Render can detect the service. Background work keeps running while server answers health checks.

const fetch = require('node-fetch');
const http = require('http');

const WORKER_URL = process.env.WORKER_URL || 'https://adad412adasdasdadsasd233s.onrender.com';
// Default to plantsvsbrainrot seed-shop API; can be overridden with env STOCK_API_URL
const STOCK_API_URL = process.env.STOCK_API_URL || 'https://plantsvsbrainrot.com/api/seed-shop.php?ts=0';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS, 10) || 2000; // 2 seconds default
const PORT = parseInt(process.env.PORT, 10) || 3000;

let lastUpdatedAt = null;
let inFlight = false;
let forceCheckInFlight = false;

const STOCK_AUTH_HEADER = process.env.STOCK_AUTH_HEADER || null; // e.g. 'Authorization'
const STOCK_AUTH_TOKEN = process.env.STOCK_AUTH_TOKEN || null; // e.g. 'Bearer xxxx'
const STOCK_FALLBACK_URL = process.env.STOCK_FALLBACK_URL || null;

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchWithRetries(url, options = {}, retries = 2, backoffMs = 500) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await wait(backoffMs * Math.pow(2, attempt));
    }
    attempt++;
  }
}

async function handleStockData(data) {
  // Only react to reportedAt (or reported_at). Ignore any updatedAt fields.
  const reportedAt = (data && (data.reportedAt || data.reported_at)) ? Number(data.reportedAt || data.reported_at) : null;

  if (reportedAt && lastUpdatedAt && reportedAt !== lastUpdatedAt) {
    console.log(new Date().toISOString(), 'Detected reportedAt change:', lastUpdatedAt, '->', reportedAt);
    // Avoid triggering multiple concurrent force-checks: set lastUpdatedAt early
    // and use an in-flight guard so the same reportedAt doesn't cause repeated calls.
    if (!forceCheckInFlight) {
      forceCheckInFlight = true;
      // Set locally to prevent subsequent polls from re-triggering for the same reportedAt
      lastUpdatedAt = reportedAt;
      try {
        const r = await fetch(`${WORKER_URL}/force-check`);
        console.log(new Date().toISOString(), '/force-check status:', r.status);
      } catch (err) {
        console.error(new Date().toISOString(), 'Error calling /force-check:', err && err.message ? err.message : err);
      } finally {
        forceCheckInFlight = false;
      }
    } else {
      console.log(new Date().toISOString(), 'Force-check already in flight; skipping duplicate trigger');
    }
  }

  if (reportedAt && lastUpdatedAt === null) {
    console.log(new Date().toISOString(), 'Initial reportedAt set to', reportedAt);
  }
  if (reportedAt) lastUpdatedAt = reportedAt;
}

async function fetchStockOnce() {
  if (inFlight) return;
  inFlight = true;
  try {
    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'pvbr-poller/1.0'
    };
    if (STOCK_AUTH_HEADER && STOCK_AUTH_TOKEN) headers[STOCK_AUTH_HEADER] = STOCK_AUTH_TOKEN;

    const res = await fetchWithRetries(STOCK_API_URL, { headers }, 2, 300);

    if (!res.ok) {
      // Log detailed info for debugging 403/4xx
      const bodyText = await res.text().catch(() => '<non-text body>');
      console.warn(new Date().toISOString(), 'stock api returned', res.status, bodyText);

      // If 403 and fallback URL is configured, try fallback once
      if (res.status === 403 && STOCK_FALLBACK_URL) {
        try {
          console.log(new Date().toISOString(), 'Attempting fallback STOCK_FALLBACK_URL');
          const fallbackRes = await fetchWithRetries(STOCK_FALLBACK_URL, { headers }, 1, 300);
          if (fallbackRes.ok) {
            const data = await fallbackRes.json();
            await handleStockData(data);
            return;
          } else {
            const fbText = await fallbackRes.text().catch(() => '<non-text>');
            console.warn(new Date().toISOString(), 'fallback returned', fallbackRes.status, fbText);
          }
        } catch (err) {
          console.error(new Date().toISOString(), 'Error fetching fallback URL:', err && err.message ? err.message : err);
        }
      }

      return;
    }

    const data = await res.json();
    // Process and handle updatedAt change
    await handleStockData(data);
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



