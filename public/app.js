const $ = id => document.getElementById(id);
const pairInput = $('pair');
const intervalInput = $('interval');
const button = $('analyze');
const status = $('status');
let latestResult = null;

const formatPrice = value => {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    if (Math.abs(value) < 1) return value.toFixed(6);
    if (Math.abs(value) < 10) return value.toFixed(4);
    if (Math.abs(value) < 1000) return value.toFixed(3);
    return value.toFixed(2);
};

const formatDate = value => value ? new Date(value).toISOString() : 'N/A';
const line = (label, value, copyValue = null) => `<div class="terminal-line"><span>${label}</span><strong>${value}</strong>${copyValue === null ? '' : `<button class="inline-copy" data-copy="${copyValue}">COPY</button>`}</div>`;

function buildOutput(result) {
    const fib = result.fibonacci;
    const pivot = result.dailyPivot;
    const fiboLines = [
        ['Swing low / high      :', result.swing ? `${formatPrice(result.swing.low)} / ${formatPrice(result.swing.high)}` : 'tidak ditemukan swing valid'],
        ['Fibo 38.2%            :', formatPrice(fib?.f382), formatPrice(fib?.f382)],
        ['Fibo 50.0%            :', formatPrice(fib?.f500), formatPrice(fib?.f500)],
        ['Fibo 61.8%            :', formatPrice(fib?.f618), formatPrice(fib?.f618)],
        ['Zona pullback         :', result.zone ? `${formatPrice(result.zone.low)} - ${formatPrice(result.zone.high)}` : 'N/A'],
        ['Harga di zona?        :', result.inZone ? 'YA' : 'TIDAK']
    ];
    const pivotText = pivot ? `Pivot harian (${pivot.sourceDate}) : PP ${formatPrice(pivot.pp)} | S1 ${formatPrice(pivot.s1)} | R1 ${formatPrice(pivot.r1)}` : 'Pivot harian          : tidak tersedia';
    const nearby = result.nearbyDailyLevels?.length ? `Level harian dekat harga: ${result.nearbyDailyLevels.map(x => `${x.name} ${formatPrice(x.value)}`).join(', ')}` : '';
    const rows = [
        ['Waktu candle terakhir :', formatDate(result.candleTime)],
        ['Harga penutupan       :', formatPrice(result.close)],
        ['Tren EMA              :', result.trend],
        ['EMA20 / EMA50         :', `${formatPrice(result.ema20)} / ${formatPrice(result.ema50)}`],
        ['RSI(14)               :', formatPrice(result.rsi)],
        ['ATR(14)               :', formatPrice(result.atr)],
        ...fiboLines,
        [pivotText.slice(0, pivotText.indexOf(':') + 1), pivotText.slice(pivotText.indexOf(':') + 1).trim()],
        ...(nearby ? [[nearby, '']] : [])
    ];
    const html = rows.map(([label, value, copyValue]) => line(label, value, copyValue)).join('');
    $('bot-output').innerHTML = `${html}<div class="terminal-divider"></div>${line('SINYAL:', result.signal)}${line('Alasan:', result.reason)}`;
    return fiboLines.map(([label, value]) => `${label} ${value}`).join('\n');
}

function render(data) {
    const { result } = data;
    latestResult = result;
    $('pair-title').textContent = result.symbol;
    $('candle-count').textContent = `${result.closedCandleCount || data.candles.length} CANDLES`;
    $('updated').textContent = `UPDATED ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
    $('bot-output').className = `bot-output ${result.signal === 'WAIT' ? 'is-wait' : 'is-signal'}`;
    buildOutput(result);
    $('dashboard').classList.remove('hidden');
}

async function copyText(text, buttonElement) {
    try {
        await navigator.clipboard.writeText(text);
        const oldText = buttonElement.textContent;
        buttonElement.textContent = 'COPIED ✓';
        setTimeout(() => { buttonElement.textContent = oldText; }, 1400);
    } catch (error) {
        status.textContent = 'Clipboard tidak tersedia di browser ini.';
    }
}

async function analyze() {
    const pair = pairInput.value.trim().toUpperCase();
    if (!pair) { status.textContent = 'Masukkan pair terlebih dahulu.'; pairInput.focus(); return; }
    button.disabled = true;
    button.querySelector('span').textContent = 'READING...';
    status.textContent = 'Mengambil output strategi dari bot.js...';
    try {
        const response = await fetch(`/api/analyze?pair=${encodeURIComponent(pair)}&interval=${intervalInput.value}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Analisis gagal.');
        render(payload);
        status.textContent = 'Output bot.js berhasil diperbarui.';
    } catch (error) {
        status.textContent = `Error: ${error.message}`;
    } finally {
        button.disabled = false;
        button.querySelector('span').textContent = 'RUN BOT';
    }
}

button.addEventListener('click', analyze);
pairInput.addEventListener('keydown', event => { if (event.key === 'Enter') analyze(); });
$('copy-all').addEventListener('click', () => latestResult && copyText($('bot-output').innerText, $('copy-all')));
$('bot-output').addEventListener('click', event => {
    const copyButton = event.target.closest('.inline-copy');
    if (!copyButton) return;
    copyText(copyButton.dataset.copy, copyButton);
});
analyze();
