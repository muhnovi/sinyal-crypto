const { PivotCalculator } = require('../bot');

const allowedIntervals = new Set(['5m', '15m', '30m', '1h', '4h', '1d']);

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        res.status(405).json({ error: 'Method tidak didukung.' });
        return;
    }

    const symbol = (req.query.pair || 'BTCUSDT').trim().toUpperCase();
    const interval = req.query.interval || '15m';
    const requestedLimit = Number(req.query.limit || 250);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 250, 120), 500);

    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
        res.status(400).json({ error: 'Pair tidak valid. Contoh: BTCUSDT atau ETHUSDT.' });
        return;
    }
    if (!allowedIntervals.has(interval)) {
        res.status(400).json({ error: 'Timeframe tidak didukung.' });
        return;
    }

    try {
        const bot = new PivotCalculator(symbol, interval, limit);
        const candles = await bot.fetchCandles();
        if (!candles) {
            res.status(502).json({
                error: 'Binance menolak akses dari lokasi server Vercel. Ubah region function ke Singapore atau deploy API ke VPS/Render yang diizinkan Binance.',
                detail: bot.lastMarketError || 'Market data tidak tersedia.'
            });
            return;
        }

        const dailyPivot = await bot.getDailyPivot();
        const result = bot.calculate(candles, dailyPivot);
        if (!result) {
            res.status(422).json({ error: 'Data candle belum cukup untuk dianalisis.' });
            return;
        }

        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({
            result: { ...result, closedCandleCount: candles.length },
            candles: candles.slice(-60).map(candle => ({
                time: candle.openTime,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close
            }))
        });
    } catch (error) {
        console.error('❌ Vercel API error:', error);
        res.status(500).json({ error: 'Terjadi kesalahan saat memproses analisis.' });
    }
};
