export type Product = 'creator' | 'referral';
export type Coupon = { id: number; series: number; used: boolean; visitor?: string };
export type Activity = { action: string; tx: string; at: number; label: string };
export type Journey = { id: string; product: Product; count: number; campaign: number | null; status: 'new' | 'draft' | 'active'; coupons: Coupon[]; series: { id: number; name: string; code: string }[]; history: Activity[]; issued: number; redeemed: number };
export const CONTRACT = '0x02bc9f6f8e524f8944293e361cf7bf6321f63558f209bf25f3c3653e50edf65e';
export const EXPLORER = 'https://sepolia.voyager.online';
export const STEP_NAMES = ['Preparar', 'Emitir', 'Activar', 'Probar', 'Resultados'];
export function currentStep(j: Journey | null): number { if (!j?.campaign) return 0; if (!j.issued) return 1; if (j.status !== 'active') return 2; return 3; }
