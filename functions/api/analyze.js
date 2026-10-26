const intervals = {
    '5m': { okx: '5m', ms: 5 * 60 * 1000 },
    '15m': { okx: '15m', ms: 15 * 60 * 1000 },
    '30m': { okx: '30m', ms: 30 * 60 * 1000 },
    '1h': { okx: '1H', ms: 60 * 60 * 1000 },
    '4h': { okx: '4H', ms: 4 * 60 * 60 * 1000 },
    '1d': { okx: '1D', ms: 24 * 60 * 60 * 1000 }
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

const ema = (values, period) => {
    if (values.length < period) return null;
    const k = 2 / (period + 1);
    let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
    return value;
};

const rsi = (values, period = 14) => {
    if (values.length <= period) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
};

const atr = (candles, period = 14) => {
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const candle = candles[i];
        const previous = candles[i - 1];
        trs.push(Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close)));
    }
    return trs.length < period ? null : trs.slice(-period).reduce((a, b) => a + b, 0) / period;
};

function swings(candles, lookback = 3) {
    const result = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
        let high = true;
        let low = true;
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j === i) continue;
            if (candles[j].high >= candles[i].high) high = false;
            if (candles[j].low <= candles[i].low) low = false;
        }
        if (high) result.push({ type: 'high', index: i, price: candles[i].high });
        if (low) result.push({ type: 'low', index: i, price: candles[i].low });
    }
    return result;
}

function fibSwing(candles, trend) {
    const found = swings(candles.slice(-100));
    for (let i = found.length - 1; i >= 0; i--) {
        if ((trend === 'BULLISH' && found[i].type === 'high') || (trend === 'BEARISH' && found[i].type === 'low')) {
            for (let j = i - 1; j >= 0; j--) {
                if (trend === 'BULLISH' && found[j].type === 'low' && found[i].price > found[j].price) return { low: found[j].price, high: found[i].price };
                if (trend === 'BEARISH' && found[j].type === 'high' && found[j].price > found[i].price) return { high: found[j].price, low: found[i].price };
            }
        }
    }
    return null;
}

function calculate(candles, symbol, interval) {
    const closes = candles.map(candle => candle.close);
    const last = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const rsi14 = rsi(closes);
    const atr14 = atr(candles);
    let trend = 'NEUTRAL';
    if (last.close > ema20 && ema20 > ema50) trend = 'BULLISH';
    if (last.close < ema20 && ema20 < ema50) trend = 'BEARISH';
    const swing = fibSwing(candles, trend);
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
    const bullishRejection = last.close > last.open && (Math.min(last.open, last.close) - last.low) > (last.high - last.low) * .2 && last.close > previous.close;
    const bearishRejection = last.close < last.open && (last.high - Math.max(last.open, last.close)) > (last.high - last.low) * .2 && last.close < previous.close;
    let signal = 'WAIT';
    let reason = 'Belum ada setup lengkap; jangan entry hanya karena harga dekat level.';
    if (trend === 'BULLISH' && inZone && bullishRejection && rsi14 >= 45 && rsi14 <= 68) {
        signal = 'POTENTIAL LONG';
        reason = 'Tren EMA bullish, harga di zona Fibonacci, candle menunjukkan penolakan bawah, RSI mendukung.';
    } else if (trend === 'BEARISH' && inZone && bearishRejection && rsi14 >= 32 && rsi14 <= 55) {
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
    let riskReward1 = null;
    if (signal !== 'WAIT' && atr14) {
        const long = signal === 'POTENTIAL LONG';
        stopLoss = long ? Math.min(swing.low, last.close - 1.5 * atr14) : Math.max(swing.high, last.close + 1.5 * atr14);
        const risk = Math.abs(last.close - stopLoss);
        if (risk > 0) {
            takeProfit1 = long ? last.close + 1.5 * risk : last.close - 1.5 * risk;
            takeProfit2 = long ? last.close + 2 * risk : last.close - 2 * risk;
            riskReward1 = 1.5;
        }
    }
    return { symbol, interval, candleTime: new Date(last.closeTime).toISOString(), close: last.close, trend, signal, reason, ema20, ema50, rsi: rsi14, atr: atr14, swing, fibonacci, zone, inZone, dailyPivot: null, nearbyDailyLevels: [], stopLoss, takeProfit1, takeProfit2, riskReward1 };
}

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const symbol = (url.searchParams.get('pair') || 'BTCUSDT').trim().toUpperCase();
    const interval = url.searchParams.get('interval') || '15m';
    const config = intervals[interval];
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return json({ error: 'Pair tidak valid.' }, 400);
    if (!config) return json({ error: 'Timeframe tidak didukung.' }, 400);
    try {
        const response = await fetch(`https://www.okx.com/api/v5/market/history-candles?instId=${symbol.replace('USDT', '-USDT')}-SWAP&bar=${config.okx}&limit=100`);
        const payload = await response.json();
        if (payload.code !== '0' || !Array.isArray(payload.data)) return json({ error: 'OKX tidak menyediakan data pair ini.' }, 502);
        const candles = payload.data.map(item => {
            const openTime = Number(item[0]);
            return { openTime, open: Number(item[1]), high: Number(item[2]), low: Number(item[3]), close: Number(item[4]), volume: Number(item[5]), closeTime: openTime + config.ms - 1 };
        }).sort((a, b) => a.openTime - b.openTime).filter(candle => candle.closeTime < Date.now());
        if (candles.length < 50) return json({ error: 'Data candle tertutup tidak cukup.' }, 422);
        const result = calculate(candles, symbol, interval);
        result.marketProvider = 'OKX Swap (Cloudflare fallback)';
        result.closedCandleCount = candles.length;
        return json({ result, candles: candles.slice(-60) });
    } catch (error) {
        return json({ error: `Market API tidak dapat diakses dari Cloudflare: ${error.message}` }, 502);
    }
}
