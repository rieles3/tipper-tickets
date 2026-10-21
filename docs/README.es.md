# Tipper Tickets

**Cupones preemitidos de creadores y atribución de referrals en Starknet.**

[English](../README.md) · [Contrato](CONTRACT.es.md) · [Despliegue](SEPOLIA.md) · [Demo](../demo/README.md)

Cada campaña define un inventario de cupones con IDs únicos. Al activarla, la emisión queda congelada para siempre. Cada canje consume un cupón existente y conserva su origen e historial.

## Productos iniciales

- **Cupones de creadores:** un alias como `MARIA10` identifica una serie y al creador asociado.
- **Referrals web:** una conversión validada consume un cupón y queda atribuida a su referidor. La misma referencia de conversión no puede usarse en otra serie de esa campaña.

Los clics y visitas no consumen automáticamente cupones. El backend valida el evento real; el contrato controla permisos, inventario y canjes únicos.

## Flujo

1. Crear una campaña con tope y vencimiento inmutables.
2. Crear series por creador o referidor.
3. Emitir cupones individuales en lotes de hasta 100, mientras está en borrador.
4. Activar y congelar el inventario realmente emitido.
5. Canjear una sola vez y consultar inventario, atribución y eventos.

**100 de tope → 50 emitidos → 20 consumidos → 30 sin consumir.** Los 50 restantes del tope nunca se emitieron y no pueden emitirse después de activar. `issued` permanece en 50.

Los cupones son registros no transferibles. El burn marca el cupón como consumido sin borrarlo; esta versión no implementa ERC-721.

## Desarrollo local

```sh
git clone https://github.com/rieles3/tipper-tickets.git
cd tipper-tickets
python3 scripts/install-tools.py
./scripts/check
```

El instalador admite macOS Apple Silicon y Linux x86-64 con glibc. Descarga versiones oficiales con SHA-256 fijado y las instala en `.tools/`, sin modificar instalaciones globales. Se requieren Python 3, curl y tar.

Herramientas: Scarb 2.20.1, Cairo 2.20.0, Starknet Foundry 0.64.1 y Universal Sierra Compiler 2.10.2. Las pruebas locales no requieren wallet ni fondos.

## Estado y siguientes fases

El contrato y la demo funcionan en Sepolia. La suite incluye 54 pruebas, con 128 casos aleatorios de conservación de inventario.

Las próximas fases son el SDK Go para Tipper y la interfaz de WhatsApp, seguida de validación con comercios y preparación para mainnet. WhatsApp forma parte del MVP completo. Tally y un portal público de API quedan fuera de esta fase.

El contrato no guarda fondos, no tiene administrador global ni mecanismo de actualización y todavía no cuenta con auditoría externa. Los cambios futuros en reglas on-chain requieren una nueva versión para campañas nuevas.

Licencia [Apache-2.0](../LICENSE); los archivos de terceros conservan sus avisos de licencia.
