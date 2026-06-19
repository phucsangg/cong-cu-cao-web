const { extractProductPrice, isModelMatch, isLikelyProductDetailUrl } = require('./lib/sheet-pricing-service.js');

async function run() {
    const url = 'https://pico.vn/may-xay-sinh-to-tefal-perfectmix-bl871d31-1200w-coi-thuy-tinh-BL871D31';
    const model = 'BL871D31';
    const brand = 'Tefal';
    const referencePrice = '1.920.000'; // from user sheet log Min/Ref

    console.log('Testing extraction for Pico...');
    try {
        const price = await extractProductPrice({
            url,
            model,
            brand,
            referencePrice,
        });
        console.log('Extracted Price:', price);
    } catch (err) {
        console.error('Error during extraction:', err);
    }
}

run();
