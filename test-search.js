const { searchProductLinks, isLikelyProductDetailUrl } = require('./lib/sheet-pricing-service.js');

async function run() {
    console.log('Searching product links for Tefal BL871D31...');
    try {
        const links = await searchProductLinks({
            brand: 'Tefal',
            model: 'BL871D31',
            limit: 20
        });
        
        console.log(`Discovered ${links.length} links:`);
        links.forEach((link, idx) => {
            const isDetail = isLikelyProductDetailUrl(link, 'BL871D31', 'Tefal');
            console.log(`[${idx + 1}] Detail=${isDetail} : ${link}`);
        });
    } catch (err) {
        console.error('Search Error:', err);
    }
}

run();
