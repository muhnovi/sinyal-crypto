const intervalConfig = {
    '5m': { bar: '5m', ms: 5 * 60 * 1000 },
    '15m': { bar: '15m', ms: 15 * 60 * 1000 },
    '30m': { bar: '30m', ms: 30 * 60 * 1000 },
    '1h': { bar: '1H', ms: 60 * 60 * 1000 },
    '4h': { bar: '4H', ms: 4 * 60 * 60 * 1000 },
    '1d': { bar: '1D', ms: 24 * 60 * 60 * 1000 }
};

const responseJson = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
    }
});

function ema(values, period) {
    const multiplier = 2 / (period + 1);
    let value = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
    for (let index = period; index < values.length; index++) value = values[index] * multiplier + value * (1 - multiplier);
    return value;
}

function calculateRsi(values, period = 14) {
    let gains = 0;
    let losses = 0;
    for (let index = 1; index <= period; index++) {
        const change = values[index] - values[index - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    let averageGain = gains / period;
    let averageLoss = losses / period;
    for (let index = period + 1; index < values.length; index++) {
        const change = values[index] - values[index - 1];
        averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
        averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    }
    if (averageLoss === 0) return 100;
    return 100 - 100 / (1 + averageGain / averageLoss);
}

function calculateAtr(candles, period = 14) {
    const ranges = [];
    for (let index = 1; index < candles.length; index++) {
        const current = candles[index];
        const previous = candles[index - 1];
        ranges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
    }
    return ranges.slice(-period).reduce((sum, item) => sum + item, 0) / period;
}

function findSwing(candles, trend) {
    const recent = candles.slice(-100);
    const candidates = [];
    for (let index = 3; index < recent.length - 3; index++) {
        let isHigh = true;
        let isLow = true;
        for (let offset = index - 3; offset <= index + 3; offset++) {
            if (offset === index) continue;
            if (recent[offset].high >= recent[index].high) isHigh = false;
            if (recent[offset].low <= recent[index].low) isLow = false;
        }
        if (isHigh) candidates.push({ type: 'high', price: recent[index].high });
        if (isLow) candidates.push({ type: 'low', price: recent[index].low });
    }
    for (let index = candidates.length - 1; index >= 0; index--) {
        const current = candidates[index];
        const wanted = trend === 'BULLISH' ? 'high' : 'low';
        const opposite = trend === 'BULLISH' ? 'low' : 'high';
        if (current.type !== wanted) continue;
        for (let previous = index - 1; previous >= 0; previous--) {
            if (candidates[previous].type !== opposite) continue;
            if (trend === 'BULLISH' && current.price > candidates[previous].price) return { low: candidates[previous].price, high: current.price };
            if (trend === 'BEARISH' && candidates[previous].price > current.price) return { high: candidates[previous].price, low: current.price };
        }
    }
    return null;
}

function calculateSignal(candles, symbol, interval) {
    const closes = candles.map(candle => candle.close);
    const last = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const rsi = calculateRsi(closes);
    const atr = calculateAtr(candles);
    const trend = last.close > ema20 && ema20 > ema50 ? 'BULLISH' : last.close < ema20 && ema20 < ema50 ? 'BEARISH' : 'NEUTRAL';
    const swing = findSwing(candles, trend);
    let fibonacci = null;
    let zone = null;
    if (swing) {
        const range = swing.high - swing.low;
        fibonacci = trend === 'BULLISH'
            ? { f382: swing.high - range * .382, f500: swing.high - range * .5, f618: swing.high - range * .618, f786: swing.high - range * .786 }
            : { f382: swing.low + range * .382, f500: swing.low + range * .5, f618: swing.low + range * .618, f786: swing.low + range * .786 };
        zone = trend === 'BULLISH' ? { low: fibonacci.f618, high: fibonacci.f382 } : { low: fibonacci.f382, high: fibonacci.f618 };
    }
    const inZone = Boolean(zone && last.close >= zone.low && last.close <= zone.high);
    const bullishRejection = last.close > last.open && Math.min(last.open, last.close) - last.low > (last.high - last.low) * .2 && last.close > previous.close;
    const bearishRejection = last.close < last.open && last.high - Math.max(last.open, last.close) > (last.high - last.low) * .2 && last.close < previous.close;
    let signal = 'WAIT';
    let reason = 'Belum ada setup lengkap; jangan entry hanya karena harga dekat level.';
    if (trend === 'BULLISH' && inZone && bullishRejection && rsi >= 45 && rsi <= 68) {
        signal = 'POTENTIAL LONG';
        reason = 'Tren EMA bullish, harga di zona Fibonacci, candle menunjukkan penolakan bawah, RSI mendukung.';
    } else if (trend === 'BEARISH' && inZone && bearishRejection && rsi >= 32 && rsi <= 55) {
        signal = 'POTENTIAL SHORT';
        reason = 'Tren EMA bearish, harga di zona Fibonacci, candle menunjukkan penolakan atas, RSI mendukung.';
    } else if (trend !== 'NEUTRAL' && !inZone) {
        reason = 'Tren terdeteksi, tetapi harga belum berada di zona Fibonacci 38.2%-61.8%. Tunggu pullback; jangan mengejar candle.';
    } else if (trend === 'NEUTRAL') {
        reason = 'EMA20 dan EMA50 belum menunjukkan susunan tren yang jelas.';
    } else {
        reason = 'Harga berada dekat zona atau di zona, tetapi konfirmasi candle/RSI belum memenuhi aturan.';
    }
    let stopLoss = null;
    let takeProfit1 = null;
    let takeProfit2 = null;
    if (signal !== 'WAIT' && swing) {
        const isLong = signal === 'POTENTIAL LONG';
        stopLoss = isLong ? Math.min(swing.low, last.close - 1.5 * atr) : Math.max(swing.high, last.close + 1.5 * atr);
        const risk = Math.abs(last.close - stopLoss);
        takeProfit1 = isLong ? last.close + 1.5 * risk : last.close - 1.5 * risk;
        takeProfit2 = isLong ? last.close + 2 * risk : last.close - 2 * risk;
    }
    return {
        symbol, interval, candleTime: new Date(last.closeTime).toISOString(), close: last.close, trend, signal, reason,
        ema20, ema50, rsi, atr, swing, fibonacci, zone, inZone, dailyPivot: null, nearbyDailyLevels: [],
        stopLoss, takeProfit1, takeProfit2, riskReward1: signal === 'WAIT' ? null : 1.5,
        marketProvider: 'OKX Swap (Cloudflare Worker)', closedCandleCount: candles.length
    };
}

async function analyze(request) {
    const url = new URL(request.url);
    const symbol = (url.searchParams.get('pair') || 'BTCUSDT').trim().toUpperCase();
    const interval = url.searchParams.get('interval') || '15m';
    const config = intervalConfig[interval];
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return responseJson({ error: 'Pair tidak valid.' }, 400);
    if (!config) return responseJson({ error: 'Timeframe tidak didukung.' }, 400);
    try {
        const binanceInterval = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d' }[interval];
        try {
            const binanceResponse = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${binanceInterval}&limit=100`);
            const binancePayload = await binanceResponse.json();
            if (binanceResponse.ok && Array.isArray(binancePayload)) {
                const candles = binancePayload.map(item => ({
                    openTime: Number(item[0]),
                    open: Number(item[1]),
                    high: Number(item[2]),
                    low: Number(item[3]),
                    close: Number(item[4]),
                    volume: Number(item[5]),
                    closeTime: Number(item[6])
                })).filter(candle => candle.closeTime < Date.now());
                if (candles.length >= 50) {
                    const result = calculateSignal(candles, symbol, interval);
                    result.marketProvider = 'Binance Futures';
                    result.closedCandleCount = candles.length;
                    return responseJson({ result, candles: candles.slice(-60) });
                }
            }
        } catch (binanceError) {
            console.warn('Binance tidak tersedia, lanjut ke OKX fallback:', binanceError.message);
        }

        const instrument = `${symbol.replace(/USDT$/, '-USDT')}-SWAP`;
        const endpoint = `https://www.okx.com/api/v5/market/history-candles?instId=${instrument}&bar=${config.bar}&limit=100`;
        const response = await fetch(endpoint);
        const payload = await response.json();
        if (payload.code !== '0' || !Array.isArray(payload.data)) return responseJson({ error: 'OKX tidak menyediakan data untuk pair ini.' }, 502);
        const candles = payload.data.map(item => {
            const openTime = Number(item[0]);
            return { openTime, open: Number(item[1]), high: Number(item[2]), low: Number(item[3]), close: Number(item[4]), volume: Number(item[5]), closeTime: openTime + config.ms - 1 };
        }).filter(candle => candle.closeTime < Date.now()).sort((a, b) => a.openTime - b.openTime);
        if (candles.length < 50) return responseJson({ error: 'Data candle tertutup tidak cukup.' }, 422);
        return responseJson({ result: calculateSignal(candles, symbol, interval), candles: candles.slice(-60) });
    } catch (error) {
        return responseJson({ error: `Market API tidak dapat diakses: ${error.message}` }, 502);
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/analyze' && request.method === 'GET') return analyze(request);
        if (url.pathname === '/api/analyze') return responseJson({ error: 'Method tidak didukung.' }, 405);
        return env.ASSETS.fetch(request);
    }
};
