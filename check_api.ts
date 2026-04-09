import fs from 'fs';
async function main() {
    try {
        const res = await fetch('http://localhost:3000/api/orders?status=RECIBIDO_EN_BODEGA');
        const data = await res.json();
        fs.writeFileSync('api_response.json', JSON.stringify(data, null, 2), 'utf8');
    } catch (e: any) {
        console.error(e.message);
    }
}
main();
