import { env } from 'cloudflare:workers';
import { CONTRACT, type Journey } from '@/lib/demo-types';
import { signer, provider, call, felt, short, events, chainCampaign, userError } from '@/lib/chain';

export const dynamic = 'force-dynamic';
const db = () => (env as unknown as { DB: D1Database }).DB;
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(id);
async function getJourney(id: string): Promise<Journey | null> { const row = await db().prepare('SELECT state FROM journeys WHERE id = ?').bind(id).first<{state: string}>(); return row ? JSON.parse(row.state) : null; }
async function release(id: string) { await db().prepare('DELETE FROM relay_lock WHERE job_id = ?').bind(id).run(); }

async function settle(job: any) {
  if (job.status !== 'submitted') return job;
  let receipt: any;
  try { receipt = await provider().getTransactionReceipt(job.tx); } catch { return job; }
  if (!['ACCEPTED_ON_L1','ACCEPTED_ON_L2'].includes(receipt.finality_status) || !receipt.execution_status) return job;
  if (receipt.execution_status !== 'SUCCEEDED') {
    const failure = userError(receipt.revert_reason || 'NETWORK_ERROR');
    await db().prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?').bind('rejected', JSON.stringify(failure), job.id).run();
    await release(job.id);
    return { ...job, status: 'rejected', error: JSON.stringify(failure) };
  }
  const j = await getJourney(job.journey);
  if (!j) throw new Error('Missing journey');
  if (!j.history.some(h => h.tx === job.tx)) {
    for (const e of events(receipt, 'CampaignCreated')) { j.campaign = Number(BigInt(e.keys[1])); j.status = 'draft'; }
    for (const e of events(receipt, 'SeriesCreated')) {
      const id = Number(BigInt(e.keys[2]));
      j.series.push({ id, name: id === 1 ? 'María' : 'Diego', code: j.product === 'creator' ? 'MARIA10SALE' : id === 1 ? 'REF_MARIA' : 'REF_DIEGO' });
    }
    for (const e of events(receipt, 'CouponIssued')) j.coupons.push({ id: Number(BigInt(e.data[0])), series: Number(BigInt(e.keys[2])), used: false });
    if (events(receipt, 'InventoryFrozen').length) j.status = 'active';
    for (const e of events(receipt, 'CouponRedeemed')) { const c = j.coupons.find(c => c.id === Number(BigInt(e.data[0]))); if (c) c.used = true; }
    j.issued = j.coupons.length; j.redeemed = j.coupons.filter(c => c.used).length;
    const labels: Record<string, string> = { create: 'Campaña creada', issue: `${j.issued} cupones emitidos`, activate: 'Inventario congelado', redeem: 'Cupón consumido', bulk: 'Canjes confirmados' };
    j.history.push({ action: job.action, tx: job.tx, at: Date.now(), label: labels[job.action] || 'Operación confirmada' });
    await db().batch([
      db().prepare('UPDATE journeys SET state = ? WHERE id = ?').bind(JSON.stringify(j), j.id),
      db().prepare('UPDATE jobs SET status = ? WHERE id = ?').bind('confirmed', job.id),
    ]);
  }
  await release(job.id);
  return { ...job, status: 'confirmed' };
}

export async function GET(request: Request) {
  try {
    const u = new URL(request.url);
    if (u.searchParams.has('network')) {
      const [creator, referral] = await Promise.all([chainCampaign(1), chainCampaign(2)]);
      return response({ contract: CONTRACT, creator, referral, checkedAt: Date.now(), network: 'Starknet Sepolia' });
    }
    const jobId = u.searchParams.get('job');
    if (jobId && validId(jobId)) {
      let job: any = await db().prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first();
      if (!job) return response({ error: 'Operación no encontrada' }, 404);
      job = await settle(job);
      return response({ job: { id: job.id, status: job.status, tx: job.tx, error: job.error ? JSON.parse(String(job.error)) : null }, journey: await getJourney(String(job.journey)) });
    }
    const id = u.searchParams.get('session');
    if (!id || !validId(id)) return response({ journey: null });
    // Recover an operation even if the browser closed after it was submitted.
    const pending = await db().prepare("SELECT * FROM jobs WHERE journey = ? AND status IN ('submitted','sending') ORDER BY created_at DESC LIMIT 1").bind(id).first();
    const settled = pending ? await settle(pending) : null;
    return response({ journey: await getJourney(id), pending: settled && settled.status !== 'confirmed' ? {id: settled.id, status: settled.status, tx: settled.tx} : null });
  } catch { return response({ error: 'No pudimos consultar Sepolia. Vuelve a intentarlo.' }, 503); }
}

export async function POST(request: Request) {
  let jobId = '';
  try {
    const body = await request.json() as Record<string, any>;
    const { session, action, requestId } = body;
    if (!validId(session) || !validId(requestId) || !['create','issue','activate','redeem','bulk','repeat','late-issue'].includes(action)) return response({ error: 'Solicitud inválida' }, 400);
    jobId = requestId;
    const existing = await db().prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first();
    if (existing) return response({ job: { id: existing.id, status: existing.status, tx: existing.tx }, error: existing.error ? JSON.parse(String(existing.error)) : null });
    const lock = await db().prepare("INSERT INTO relay_lock (id,job_id,until) VALUES ('signer',?,?) ON CONFLICT(id) DO UPDATE SET job_id=excluded.job_id,until=excluded.until WHERE relay_lock.until < ? RETURNING job_id").bind(jobId,Date.now()+180000,Date.now()).first();
    if (!lock) return response({ code: 'QUEUE_BUSY', message: 'Otra persona está confirmando su operación. Tu turno sigue enseguida.' }, 409);
    let j = await getJourney(session);
    if (action === 'create') {
      if (j?.campaign) throw new Error('BAD_STEP');
      if (!['creator','referral'].includes(body.product) || ![10,20,50].includes(body.count)) throw new Error('BAD_STEP');
      j = { id: session, product: body.product, count: body.count, campaign: null, status: 'new', coupons: [], series: [], history: [], issued: 0, redeemed: 0 };
      await db().prepare('INSERT INTO journeys (id,state,created_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').bind(session,JSON.stringify(j),Date.now()).run();
    }
    if (!j) throw new Error('BAD_STEP');
    const calls = [];
    const commitment = (i: number) => felt(`tipper-demo:${session}:coupon:${i}`);
    if (action === 'create') calls.push(call('create_campaign', [j.product === 'creator' ? 0 : 1,100,Math.floor(Date.now()/1000)+604800,felt(`tipper-demo:${session}`)]));
    else if (action === 'issue') {
      if (j.status !== 'draft' || j.issued || !j.campaign) throw new Error('BAD_STEP');
      const a = j.product === 'creator' ? j.count : j.count/2;
      calls.push(call('create_series',[j.campaign,short('maria'),short(j.product === 'creator' ? 'MARIA10SALE' : 'REF_MARIA'),j.product === 'creator' ? 100 : 50]));
      calls.push(call('issue_coupons',[j.campaign,1,a,...Array.from({length:a},(_,i)=>commitment(i))]));
      if (j.product === 'referral') {
        calls.push(call('create_series',[j.campaign,short('diego'),short('REF_DIEGO'),50]));
        calls.push(call('issue_coupons',[j.campaign,2,a,...Array.from({length:a},(_,i)=>commitment(i+a))]));
      }
    } else if (action === 'activate') {
      if (j.status !== 'draft' || !j.issued || !j.campaign) throw new Error('BAD_STEP');
      calls.push(call('activate_campaign',[j.campaign]));
    } else if (action === 'late-issue') {
      if (j.status !== 'active') throw new Error('BAD_STEP');
      calls.push(call('issue_coupons',[j.campaign!,1,1,felt(`late:${jobId}`)]));
    } else {
      if (j.status !== 'active') throw new Error('BAD_STEP');
      const source = j.product === 'creator' ? 1 : body.source === 2 ? 2 : 1;
      if (action === 'repeat') {
        const c = j.coupons.find(c=>c.used);
        if (!c) throw new Error('BAD_STEP');
        calls.push(call('redeem_coupon',[c.id,felt(`repeat:${jobId}`)]));
      } else if (action === 'bulk') {
        if (j.product !== 'creator') throw new Error('BAD_STEP');
        const coupons = j.coupons.filter(c=>!c.used).slice(0,Math.min(20,Number(body.amount)||20));
        if (!coupons.length) throw new Error('EMPTY_STOCK');
        coupons.forEach((c,i)=>calls.push(call('redeem_coupon',[c.id,felt(`bulk:${jobId}:${i}`)])));
      } else {
        if (typeof body.visitor !== 'string' || !/^person-\d{1,4}$/.test(body.visitor)) throw new Error('BAD_STEP');
        const coupon = j.coupons.find(c=>!c.used && c.series === source);
        if (!coupon) throw new Error('EMPTY_STOCK');
        calls.push(call('redeem_coupon',[coupon.id,felt(`conversion:${session}:${body.visitor}`)]));
      }
    }
    await db().prepare('INSERT INTO jobs (id,journey,action,status,created_at) VALUES (?,?,?,?,?)').bind(jobId,session,action,'sending',Date.now()).run();
    // The public interface only builds the demo calls above; no arbitrary calldata.
    const account = signer();
    if (BigInt(await provider().getChainId()) !== BigInt('0x534e5f5345504f4c4941')) throw new Error('Wrong network');
    const sent = await account.execute(calls);
    await db().prepare('UPDATE jobs SET status = ?, tx = ? WHERE id = ?').bind('submitted',sent.transaction_hash,jobId).run();
    return response({ job: { id:jobId,status:'submitted',tx:sent.transaction_hash } });
  } catch (error) {
    const failure = userError(error);
    if (jobId) {
      await db().prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?').bind('rejected',JSON.stringify(failure),jobId).run();
      await release(jobId);
    }
    return response({ error: failure, simulatedRejection: ['ALREADY_REDEEMED','DUPLICATE_CONVERSION','INVENTORY_FROZEN'].includes(failure.code) }, 400);
  }
}
