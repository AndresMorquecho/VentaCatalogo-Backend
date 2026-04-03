
const notes = "hola | CAMBIO DE [PD-2026-002 Adidas x1: Descripción del cambio (Se va):] POR [Avon x1: DETALLES SOBRE EL CAMBIO]";
const regex = /CAMBIO DE \[([^\s]+)\s+(.*?)\s*x(\d+):\s*([\s\S]*?)\]\s*POR\s*\[(.*?)\s*x(\d+):\s*([\s\S]*?)\]/i;
const match = notes.match(regex);

if (match) {
    console.log("MATCH FOUND!");
    console.log("Original Order:", match[1]);
    console.log("Original Brand:", match[2]);
    console.log("Original Qty:", match[3]);
    console.log("Original Desc:", match[4]);
    console.log("New Brand:", match[5]);
    console.log("New Qty:", match[6]);
    console.log("New Desc:", match[7]);
} else {
    console.log("NO MATCH FAIL!");
}
