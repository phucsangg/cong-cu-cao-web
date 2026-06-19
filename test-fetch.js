const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function testUrl(name, url) {
    console.log(`\nTesting ${name}: ${url}`);
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'user-agent': DEFAULT_USER_AGENT,
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                'cache-control': 'max-age=0',
            }
        });
        console.log(`Status: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.log(`Body Length: ${text.length}`);
        
        // Print snippet of body to check if Cloudflare or real page
        if (text.includes('cloudflare') || text.includes('captcha') || text.includes('attention') || text.includes('security')) {
            console.log('Blocked by Cloudflare/Security wrapper!');
        } else {
            console.log('Real page parsed successfully!');
        }
    } catch (err) {
        console.error('Fetch Error:', err.message);
    }
}

async function run() {
    await testUrl('Pico', 'https://pico.vn/may-xay-sinh-to-tefal-perfectmix-bl871d31-1200w-coi-thuy-tinh-BL871D31');
    await testUrl('HC', 'https://hc.com.vn/ords/product/may-xay-sinh-to-tefal-bl871d31');
    await testUrl('META', 'https://meta.vn/may-xay-sinh-to-tefal-perfectmix-bl871d31-p103739');
}

run();
