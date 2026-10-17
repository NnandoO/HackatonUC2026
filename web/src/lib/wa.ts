/**
 * Enlaces de WhatsApp del taller (+51 Perú). Todos los CTA de la
 * tienda apuntan al número de Angibell con el mensaje listo.
 */
const NUMERO_WHATSAPP = "51946729731";

export function waLink(mensaje: string): string {
  return `https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent(mensaje)}`;
}

export const MSG_CATALOGO =
  "Hola, quiero hacer un pedido del catálogo de Angibell Creaciones.";
