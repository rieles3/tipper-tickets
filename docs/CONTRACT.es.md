# Contrato v0.1.0

## Inventario y ciclo de vida

`Draft → Active → Closed`; también se permite `Draft → Closed`. No hay retorno a un estado anterior. La pausa es reversible únicamente en estado Active. El vencimiento se evalúa con el timestamp de bloque: en `now >= expires_at` se bloquean emisión, creación de series, activación y canjes, sin borrar el historial ni cambiar automáticamente el enum de estado.

El tope de campaña y los topes de las series quedan fijos al crearlos. La suma de topes de series no puede exceder el tope de campaña. Se puede emitir menos que el tope. Al activar queda fijo el total **realmente emitido**; el tope no debe mostrarse al usuario como cantidad emitida.

Invariantes por campaña y serie:

```text
0 <= redeemed <= issued <= supply_cap
unconsumed = issued - redeemed
```

`unconsumed` no significa canjeable: si la campaña está pausada, cerrada o vencida, esos cupones no se pueden canjear. Para un cupón concreto consultar `is_redeemable`; esta lectura comprueba su estado, no los permisos del caller. `is_operator` comprueba permisos, no el estado de la campaña.

El ID de campaña es global al contrato. El ID de serie es local a la campaña. El ID de cupón es global al contrato. Todos comienzan en 1; el 0 es reservado para ausencia. La identidad completa incluye red y dirección del contrato.

## Roles

| Acción | Propietario de campaña | Operador de esa campaña | Público |
| --- | --- | --- | --- |
| Crear campaña propia | Sí | Sí, como nuevo propietario | Sí, mediante cuenta Starknet |
| Crear series / emitir / activar | Sí, en Draft | No | No |
| Autorizar o revocar operadores | Sí, hasta cerrar | No | No |
| Pausar / reanudar / cerrar | Sí, según estado | No | No |
| Canjear | Sí | Sí | No |
| Leer inventario y eventos | Sí | Sí | Sí |

La dirección de la cuenta que crea la campaña es su propietario permanente. No hay cambio de propietario, administrador global, transferencias de cupones, pagos, llamadas externas ni mecanismo de upgrade en el contrato.

## Identificadores y privacidad

- `source_id`: identificador fijo del creador o referidor. Puede aparecer en distintas series; la aplicación puede agregar sus resultados.
- `public_code`: alias único **dentro de la campaña**, como `MARIA10`. Conocerlo no autoriza a canjear. La aplicación debe conservar el contexto de campaña al resolver códigos.
- `commitment`: identificador opaco no nulo y único dentro de la campaña para cada cupón. Se registra en el momento de emisión y nunca cambia. El contrato verifica unicidad, no preimágenes criptográficas.
- `conversion_ref`: referencia opaca no nula, estable para el evento de negocio validado. Solo puede consumirse una vez en toda la campaña, aunque se intente atribuirlo a otra serie. La estabilidad de esta referencia es responsabilidad del backend; inventar una referencia diferente eludiría la deduplicación del mismo evento real.
- `metadata_hash`: compromiso inmutable opcional de términos externos; cero significa que no se suministró. Al usarlo, conservar también el documento original y el algoritmo de hash para poder verificarlo.

Estos datos son públicos. El SDK deberá usar identificadores aleatorios o hashes con separación de dominios y protección adecuada; no publicar teléfonos, correos, IDs de usuario ni hashes simples de datos fáciles de adivinar. Los valores numéricos pequeños de las pruebas solo son fixtures.

`felt252` debe ser menor que el primo de campo Cairo: `2^251 + 17*2^192 + 1`. El SDK debe acordar y probar su codificación. Un texto ASCII corto cabe hasta 31 bytes; la normalización de alias es responsabilidad de la aplicación. No truncar ciegamente UUIDs o hashes de 256 bits.

## Canje y burn

`redeem_coupon(coupon_id, conversion_ref)` verifica operador, estado Active, pausa, vencimiento, cupón sin consumir y referencia no usada. Registra el operador, timestamp y referencia; aumenta `redeemed` en serie y campaña y emite `CouponRedeemed` con la fuente original.

La operación no crea cupones y no libera capacidad. Un segundo canje revierte sin cambiar nada. Si dos solicitudes usan el mismo cupón, solo la primera transacción aceptada puede consumirlo. El backend debe reservar cupones para evitar contención; el contrato sigue siendo la última comprobación.

En emisión por lotes, cualquier duplicado o valor inválido revierte el lote completo, incluidos sus IDs y contadores.

La recuperación tras un timeout se hace consultando `get_coupon` o `conversion_coupon`. No reintentar con otra referencia de conversión. Confirmar receipt exitoso antes de entregar el beneficio; emitir una transacción no equivale a haber canjeado.

## Auditoría

Los eventos `CampaignCreated`, `SeriesCreated`, `CouponIssued`, `InventoryFrozen` y `CouponRedeemed` permiten reconstruir origen, emisión y consumo. Pausas, operadores y cierres también generan eventos. Los registros consumidos siguen disponibles con `get_coupon`.

No hay indexador en esta fase. Las consultas individuales y contadores están disponibles directamente; para listas históricas el SDK podrá paginar eventos vía RPC. No existe una operación pública para ajustar contadores.

La cadena prueba lo que registró el operador autorizado, no la existencia de una compra o persona real. Un operador malicioso puede consumir inventario con referencias nuevas: el modelo confía en la validación del comercio/backend. Los permisos y la revocación limitan quién puede hacerlo.

## ABI para el SDK Go

La ABI compilada aparece en `target/dev/tipper_tickets_BurnLedger.contract_class.json` bajo `abi`. Referencia normativa: `src/interfaces.cairo` y `src/types.cairo`.

Con calldata cruda, los enums sin contenido se serializan por índice: `CreatorCoupon=0`, `Referral=1`; `Draft=0`, `Active=1`, `Closed=2`. Los spans llevan primero su longitud. Los IDs `u64`, booleanos y cada `felt252` ocupan un felt. Las estructuras devueltas siguen el orden de campos declarado en `types.cairo`.

El SDK no necesita un servidor de API público: se integra en Tipper, que ya tiene su backend y su infraestructura de credenciales. WhatsApp llamará a ese backend; nunca recibirá la clave privada de Starknet.

## Evolución

El contrato v0.1.0 no puede reemplazar su clase. Las nuevas funcionalidades de integración pueden añadirse al SDK/backend sin cambiar el contrato. Si cambian las reglas onchain, desplegar una nueva versión y usarla para campañas nuevas. Conservar la dirección y versión originales de cada campaña; no migrar ni reinterpretar su historial silenciosamente.
