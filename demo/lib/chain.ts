import { env } from 'cloudflare:workers';
import { Account, RpcProvider, hash, shortString } from 'starknet';
import { CONTRACT } from './demo-types';

export function config() {
  const e = env as unknown as Record<string, string>;
  const nodeUrl = e.STARKNET_RPC_URL || 'https://starknet-sepolia-rpc.publicnode.com';
  return { nodeUrl, address: e.DEMO_ACCOUNT_ADDRESS, key: e.DEMO_PRIVATE_KEY };
}
export function provider() { return new RpcProvider({ nodeUrl: config().nodeUrl }); }
export function signer() {
  const c = config();
  if (!c.address || !c.key) throw new Error('DEMO_NOT_CONFIGURED');
  return new Account({ provider: provider(), address: c.address, signer: c.key });
}
export function call(entrypoint: string, calldata: (string | number)[]) { return { contractAddress: CONTRACT, entrypoint, calldata: calldata.map(String) }; }
export function felt(text: string) { return hash.starknetKeccak(text).toString(); }
export function short(text: string) { return shortString.encodeShortString(text); }
export function events(receipt: any, name: string) {
  const selector = BigInt(hash.getSelectorFromName(name));
  return (receipt.events || []).filter((e: any) => BigInt(e.from_address) === BigInt(CONTRACT) && BigInt(e.keys[0]) === selector);
}
export async function chainCampaign(id: number) {
  const raw = await provider().callContract(call('get_campaign', [id]), 'latest');
  const v = raw.map(x => BigInt(x));
  return { id, status: Number(v[2]), cap: Number(v[3]), issued: Number(v[5]), redeemed: Number(v[6]) };
}
export function userError(error: unknown) {
  const raw = String(error);
  const errors: Record<string,string> = {
    ALREADY_REDEEMED: 'Este cupón ya se consumió. Su ID sigue en el historial y no puede usarse otra vez.',
    DUPLICATE_CONVERSION: 'Esta conversión ya tiene un referidor. Cambiar de enlace no permite contar a la misma persona dos veces.',
    INVENTORY_FROZEN: 'El inventario ya está congelado. No se pueden emitir cupones nuevos en esta campaña.',
    DEMO_NOT_CONFIGURED: 'Estamos preparando el patrocinio de gas. Vuelve a intentarlo en un momento.',
    EMPTY_STOCK: 'Se consumieron los cupones de esta persona. Puedes probar el otro enlace o empezar una campaña nueva.',
    BAD_STEP: 'Primero termina el paso anterior del recorrido.',
    EXPIRED: 'Esta campaña de prueba ya venció. Empieza un recorrido nuevo.',
  };
  for (const [code, message] of Object.entries(errors)) if (raw.includes(code)) return { code, message };
  if (/balance|insufficient/i.test(raw)) return { code: 'GAS_EMPTY', message: 'Se agotó el gas de prueba de la demo. El historial y los resultados siguen disponibles.' };
  return { code: 'NETWORK_ERROR', message: 'Sepolia no respondió como esperábamos. Revisa el estado antes de enviar otra operación.' };
}
