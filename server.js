const http = require('http');
const fs = require('fs');
const path = require('path');
const { PivotCalculator } = require('./bot');

const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);
const allowedIntervals = new Set(['5m', '15m', '30m', '1h', '4h', '1d']);

function sendJson(res, status, payload) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
    fs.readFile(filePath, (error, content) => {
        if (error) {
            sendJson(res, 404, { error: 'Halaman tidak ditemukan.' });
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
}

async function analyze(url, res) {
    const symbol = (url.searchParams.get('pair') || 'BTCUSDT').trim().toUpperCase();
    const interval = url.searchParams.get('interval') || '15m';
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 250), 120), 500);

    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
        sendJson(res, 400, { error: 'Pair tidak valid. Contoh: BTCUSDT atau ETHUSDT.' });
        return;
    }
    if (!allowedIntervals.has(interval)) {
        sendJson(res, 400, { error: 'Timeframe tidak didukung.' });
        return;
    }

    const bot = new PivotCalculator(symbol, interval, limit);
    const candles = await bot.fetchCandles();
    if (!candles) {
        sendJson(res, 502, { error: 'Data market gagal diambil dari Binance. Coba lagi sebentar.' });
        return;
    }

    const dailyPivot = await bot.getDailyPivot();
    const result = bot.calculate(candles, dailyPivot);
    if (!result) {
        sendJson(res, 422, { error: 'Data candle belum cukup untuk dianalisis.' });
        return;
    }

    sendJson(res, 200, {
        result: { ...result, closedCandleCount: candles.length, marketProvider: bot.marketProvider },
        candles: candles.slice(-60).map(candle => ({
            time: candle.openTime,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close
        }))
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    try {
        if (url.pathname === '/api/analyze' && req.method === 'GET') {
            await analyze(url, res);
            return;
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
            sendFile(res, path.join(publicDir, 'index.html'), 'text/html; charset=utf-8');
            return;
        }
        if (url.pathname === '/styles.css') {
            sendFile(res, path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8');
            return;
        }
        if (url.pathname === '/app.js') {
            sendFile(res, path.join(publicDir, 'app.js'), 'application/javascript; charset=utf-8');
            return;
        }
        sendJson(res, 404, { error: 'Route tidak ditemukan.' });
    } catch (error) {
        console.error('❌ API error:', error);
        sendJson(res, 500, { error: 'Terjadi kesalahan saat memproses analisis.' });
    }
});

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${port} sedang digunakan.`);
        console.error(`Gunakan port lain: $env:PORT=3001; npm start`);
        console.error(`Atau buka server yang sudah aktif di http://localhost:${port}\n`);
        process.exitCode = 1;
        return;
    }
    console.error('❌ Server gagal berjalan:', error);
    process.exitCode = 1;
});

server.listen(port, '0.0.0.0', () => {
    console.log(`\n📈 Signal Studio berjalan di http://localhost:${port}`);
    console.log('🌐 Siap dipakai lokal atau dideploy ke hosting Node.js.\n');
});
