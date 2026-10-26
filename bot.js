const axios = require('axios');
const https = require('https');
require('dotenv').config(); 

class PivotCalculator {
    constructor(symbol = 'BTCUSDT', interval = '15m', limit = 250) {
        this.symbol = symbol.toUpperCase();
        this.interval = interval;
        this.limit = Math.max(120, limit);
        this.baseUrl = 'https://fapi.binance.com';
        this.agent = new https.Agent({
            keepAlive: true
        });
    }

    async requestKlines(interval, limit) {
        const url = `${this.baseUrl}/fapi/v1/klines`;
        try {
            const response = await axios.get(url, {
                params: { symbol: this.symbol, interval, limit },
                httpsAgent: this.agent,
                timeout: 20000
            });

            if (!Array.isArray(response.data)) {
                throw new Error(`Respons Binance tidak valid: ${JSON.stringify(response.data)}`);
            }

            this.marketProvider = 'Binance Futures';
            return response.data.map(k => ({
                openTime: Number(k[0]),
                open: Number(k[1]),
                high: Number(k[2]),
                low: Number(k[3]),
                close: Number(k[4]),
                volume: Number(k[5]),
                closeTime: Number(k[6])
            }));
        } catch (binanceError) {
            const bybitInterval = {
                '5m': '5', '15m': '15', '30m': '30',
                '1h': '60', '4h': '240', '1d': 'D'
            }[interval];
            if (!bybitInterval) throw binanceError;
            const intervalMs = interval === '1d'
                ? 24 * 60 * 60 * 1000
                : Number(bybitInterval) * 60 * 1000;

            let response;
            try {
                response = await axios.get('https://api.bybit.com/v5/market/kline', {
                    params: { category: 'linear', symbol: this.symbol, interval: bybitInterval, limit: Math.min(limit, 1000) },
                    httpsAgent: this.agent,
                    timeout: 20000
                });
                if (response.data?.retCode !== 0 || !Array.isArray(response.data?.result?.list)) {
                    throw new Error(`Respons Bybit tidak valid: ${JSON.stringify(response.data)}`);
                }
                this.marketProvider = 'Bybit Linear (fallback)';
                console.warn(`⚠️ Binance diblokir; memakai ${this.marketProvider} untuk ${this.symbol}`);
                return response.data.result.list.map(k => {
                    const openTime = Number(k[0]);
                    return {
                        openTime, open: Number(k[1]), high: Number(k[2]), low: Number(k[3]),
                        close: Number(k[4]), volume: Number(k[5]), closeTime: openTime + intervalMs - 1
                    };
                }).sort((a, b) => a.openTime - b.openTime);
            } catch (bybitError) {
                const okxBar = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' }[interval];
                const okxResponse = await axios.get('https://www.okx.com/api/v5/market/history-candles', {
                    params: { instId: `${this.symbol.replace('USDT', '-USDT')}-SWAP`, bar: okxBar, limit: Math.min(limit, 100) },
                    httpsAgent: this.agent,
                    timeout: 20000
                });
                if (okxResponse.data?.code !== '0' || !Array.isArray(okxResponse.data?.data)) {
                    throw new Error(`Respons OKX tidak valid: ${JSON.stringify(okxResponse.data)}`);
                }
                this.marketProvider = 'OKX Swap (fallback)';
                console.warn(`⚠️ Binance dan Bybit diblokir; memakai ${this.marketProvider} untuk ${this.symbol}`);
                return okxResponse.data.data.map(k => {
                    const openTime = Number(k[0]);
                    return {
                        openTime, open: Number(k[1]), high: Number(k[2]), low: Number(k[3]),
                        close: Number(k[4]), volume: Number(k[5]), closeTime: openTime + intervalMs - 1
                    };
                }).sort((a, b) => a.openTime - b.openTime);
            }
        }
    }

    async fetchCandles() {
        try {
            const candles = await this.requestKlines(this.interval, this.limit);
            const now = Date.now();
            const closed = candles.filter(c => c.closeTime < now);
            if (closed.length < 100) throw new Error(`Data candle tertutup tidak cukup: ${closed.length}`);
            console.log(`✅ ${closed.length} candle ${this.interval} tertutup berhasil diambil (${this.marketProvider || 'market API'})`);
            return closed;
        } catch (error) {
            this.lastMarketError = error.response?.data?.msg || error.message;
            console.error('❌ Gagal mengambil candle:', error.response?.data || error.message);
            return null;
        }
    }

    ema(values, period) {
        if (values.length < period) return null;
        const k = 2 / (period + 1);
        let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
        return value;
    }

    rsi(values, period = 14) {
        if (values.length <= period) return null;
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const change = values[i] - values[i - 1];
            if (change >= 0) gains += change;
            else losses -= change;
        }
        let avgGain = gains / period, avgLoss = losses / period;
        for (let i = period + 1; i < values.length; i++) {
            const change = values[i] - values[i - 1];
            avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
            avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
        }
        if (avgLoss === 0) return 100;
        return 100 - (100 / (1 + avgGain / avgLoss));
    }

    atr(candles, period = 14) {
        if (candles.length <= period) return null;
        const trs = [];
        for (let i = 1; i < candles.length; i++) {
            const c = candles[i], prev = candles[i - 1];
            trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
        }
        return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    }

    findSwings(candles, lookback = 3) {
        const swings = [];
        for (let i = lookback; i < candles.length - lookback; i++) {
            let isHigh = true, isLow = true;
            for (let j = i - lookback; j <= i + lookback; j++) {
                if (j === i) continue;
                if (candles[j].high >= candles[i].high) isHigh = false;
                if (candles[j].low <= candles[i].low) isLow = false;
            }
            if (isHigh) swings.push({ type: 'high', index: i, price: candles[i].high });
            if (isLow) swings.push({ type: 'low', index: i, price: candles[i].low });
        }
        return swings;
    }

    getFibSwing(candles, trend) {
        const start = Math.max(0, candles.length - 100);
        const recent = candles.slice(start);
        const swings = this.findSwings(recent, 3);
        if (trend === 'BULLISH') {
            for (let i = swings.length - 1; i >= 0; i--) {
                if (swings[i].type !== 'high') continue;
                for (let j = i - 1; j >= 0; j--) {
                    if (swings[j].type === 'low' && swings[i].price > swings[j].price) {
                        return { low: swings[j].price, high: swings[i].price };
                    }
                }
            }
        } else if (trend === 'BEARISH') {
            for (let i = swings.length - 1; i >= 0; i--) {
                if (swings[i].type !== 'low') continue;
                for (let j = i - 1; j >= 0; j--) {
                    if (swings[j].type === 'high' && swings[j].price > swings[i].price) {
                        return { high: swings[j].price, low: swings[i].price };
                    }
                }
            }
        }
        return null;
    }

    async getDailyPivot() {
        try {
            const daily = await this.requestKlines('1d', 3);
            const closed = daily.filter(c => c.closeTime < Date.now());
            if (closed.length < 2) return null;
            const prev = closed[closed.length - 1];
            const pp = (prev.high + prev.low + prev.close) / 3;
            return {
                pp,
                r1: 2 * pp - prev.low,
                s1: 2 * pp - prev.high,
                r2: pp + (prev.high - prev.low),
                s2: pp - (prev.high - prev.low),
                sourceDate: new Date(prev.openTime).toISOString().slice(0, 10)
            };
        } catch (error) {
            console.warn('⚠️ Pivot harian tidak tersedia:', error.response?.data || error.message);
            return null;
        }
    }

    calculate(candles, dailyPivot = null) {
        if (!candles || candles.length < 100) return null;
        const closes = candles.map(c => c.close);
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const ema20 = this.ema(closes, 20);
        const ema50 = this.ema(closes, 50);
        const rsi = this.rsi(closes, 14);
        const atr = this.atr(candles, 14);

        let trend = 'NEUTRAL';
        if (last.close > ema20 && ema20 > ema50) trend = 'BULLISH';
        if (last.close < ema20 && ema20 < ema50) trend = 'BEARISH';

        const swing = this.getFibSwing(candles, trend);
        let fib = null, zone = null;
        if (swing && swing.high > swing.low) {
            const range = swing.high - swing.low;
            if (trend === 'BULLISH') {
                fib = {
                    f382: swing.high - range * 0.382,
                    f500: swing.high - range * 0.5,
                    f618: swing.high - range * 0.618,
                    f786: swing.high - range * 0.786
                };
                zone = { low: fib.f618, high: fib.f382 };
            } else if (trend === 'BEARISH') {
                fib = {
                    f382: swing.low + range * 0.382,
                    f500: swing.low + range * 0.5,
                    f618: swing.low + range * 0.618,
                    f786: swing.low + range * 0.786
                };
                zone = { low: fib.f382, high: fib.f618 };
            }
        }

        const inZone = zone && last.close >= zone.low && last.close <= zone.high;
        const bullishRejection = last.close > last.open &&
            (Math.min(last.open, last.close) - last.low) > (last.high - last.low) * 0.2 &&
            last.close > prev.close;
        const bearishRejection = last.close < last.open &&
            (last.high - Math.max(last.open, last.close)) > (last.high - last.low) * 0.2 &&
            last.close < prev.close;

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

        let stopLoss = null, takeProfit1 = null, takeProfit2 = null, riskReward1 = null;
        if (signal !== 'WAIT' && atr) {
            const long = signal === 'POTENTIAL LONG';
            stopLoss = long ? Math.min(swing.low, last.close - 1.5 * atr) : Math.max(swing.high, last.close + 1.5 * atr);
            const risk = Math.abs(last.close - stopLoss);
            if (risk > 0) {
                takeProfit1 = long ? last.close + 1.5 * risk : last.close - 1.5 * risk;
                takeProfit2 = long ? last.close + 2 * risk : last.close - 2 * risk;
                riskReward1 = 1.5;
            }
        }

        const nearbyDailyLevels = [];
        if (dailyPivot) {
            for (const [name, value] of Object.entries(dailyPivot)) {
                if (typeof value !== 'number') continue;
                if (Math.abs(last.close - value) <= atr * 0.35) nearbyDailyLevels.push({ name, value });
            }
        }

        return {
            symbol: this.symbol, interval: this.interval,
            candleTime: new Date(last.closeTime).toISOString(),
            close: last.close, trend, signal, reason,
            ema20, ema50, rsi, atr,
            swing, fibonacci: fib, zone, inZone: Boolean(inZone),
            dailyPivot, nearbyDailyLevels,
            stopLoss, takeProfit1, takeProfit2, riskReward1
        };
    }

    async run() {
        console.log('\n════════════════════════════════════════════');
        console.log('PIVOT + FIBONACCI PULLBACK SIGNAL (CLOSED CANDLES)');
        console.log(`Symbol: ${this.symbol} | Timeframe: ${this.interval}`);
        console.log('════════════════════════════════════════════');
        const candles = await this.fetchCandles();
        if (!candles) return null;

        const dailyPivot = await this.getDailyPivot();
        const result = this.calculate(candles, dailyPivot);
        if (!result) {
            console.error('❌ Data tidak cukup untuk analisis.');
            return null;
        }

const fmt = n => {
            if (!Number.isFinite(n)) return 'N/A';
            if (Math.abs(n) < 1) return n.toFixed(6);      // Koin di bawah $1 (contoh: 0.005114)
            if (Math.abs(n) < 10) return n.toFixed(4);     // Koin $1 - $9 (contoh: 1.0745)
            if (Math.abs(n) < 1000) return n.toFixed(3);   // Koin $10 - $999 (contoh: 150.125)
            return n.toFixed(2);                           // Koin besar seperti BTC (contoh: 65000.50)
        };
        console.log(`Waktu candle terakhir : ${result.candleTime}`);
        console.log(`Harga penutupan       : ${fmt(result.close)}`);
        console.log(`Tren EMA              : ${result.trend}`);
        console.log(`EMA20 / EMA50         : ${fmt(result.ema20)} / ${fmt(result.ema50)}`);
        console.log(`RSI(14)               : ${fmt(result.rsi)}`);
        console.log(`ATR(14)               : ${fmt(result.atr)}`);
        if (result.swing) {
            console.log(`Swing low / high      : ${fmt(result.swing.low)} / ${fmt(result.swing.high)}`);
        } else {
            console.log('Swing Fibonacci       : tidak ditemukan swing valid');
        }
        if (result.fibonacci) {
            console.log(`Fibo 38.2%            : ${fmt(result.fibonacci.f382)}`);
            console.log(`Fibo 50.0%            : ${fmt(result.fibonacci.f500)}`);
            console.log(`Fibo 61.8%            : ${fmt(result.fibonacci.f618)}`);
            console.log(`Zona pullback         : ${fmt(result.zone.low)} - ${fmt(result.zone.high)}`);
            console.log(`Harga di zona?        : ${result.inZone ? 'YA' : 'TIDAK'}`);
        }
        if (dailyPivot) {
            console.log(`Pivot harian (${dailyPivot.sourceDate}) : PP ${fmt(dailyPivot.pp)} | S1 ${fmt(dailyPivot.s1)} | R1 ${fmt(dailyPivot.r1)}`);
            if (result.nearbyDailyLevels.length) {
                console.log('Level harian dekat harga:', result.nearbyDailyLevels.map(x => `${x.name} ${fmt(x.value)}`).join(', '));
            }
        }
        console.log('────────────────────────────────────────────');
        console.log(`SINYAL: ${result.signal}`);
        console.log(`Alasan: ${result.reason}`);
        if (result.stopLoss !== null) {
            console.log(`Stop Loss             : ${fmt(result.stopLoss)}`);
            console.log(`Take Profit 1 (1:1.5) : ${fmt(result.takeProfit1)}`);
            console.log(`Take Profit 2 (1:2)   : ${fmt(result.takeProfit2)}`);
        }
        console.log('Catatan: sinyal ini kandidat setup, bukan jaminan profit. Backtest dan paper-trading sebelum live.');
        console.log('════════════════════════════════════════════\n');
        return result;
    }
}

if (require.main === module) {
    (async () => {
        const rawSymbols = process.env.SYMBOL || 'BTCUSDT';
        const interval = process.env.INTERVAL || '15m';
        const limit = Number(process.env.LIMIT || 250);

        const symbols = rawSymbols
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        console.log(`🚀 Menjalankan bot untuk ${symbols.length} pair: ${symbols.join(', ')}\n`);

        for (const symbol of symbols) {
            try {
                const bot = new PivotCalculator(symbol, interval, limit);
                await bot.run();
            } catch (error) {
                console.error(`❌ Gagal memproses ${symbol}:`, error.message);
            }
        }
    })();
}

module.exports = { PivotCalculator };