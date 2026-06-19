process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function run() {
    const url = 'https://hc.com.vn/ords/product/may-xay-sinh-to-tefal-bl871d31';
    console.log('Fetching HC URL directly with TLS rejection disabled...');
    try {
        const response = await fetch(url, {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            }
        });
        console.log('Status:', response.status);
        const text = await response.text();
        console.log('Length:', text.length);
    } catch (err) {
        console.error('Fetch Error Detail:', err);
    }
}

run();
