"use client";
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, ArrowLeft, Check, Ticket, Link2, Plus, RotateCcw, Copy, Layers3, Flame, MousePointer2, ExternalLink, X, LoaderCircle, CheckCheck, Sparkles, CircleHelp, LockKeyhole, Users, Radio, ChevronDown, ChevronRight } from 'lucide-react';
import { CONTRACT, EXPLORER, STEP_NAMES, currentStep, type Journey, type Product } from '@/lib/demo-types';

const people = ['Ana','Tomás','Lucía','Nico','Sofía','Leo'];
const shortHash = (s: string) => `${s.slice(0,8)}…${s.slice(-6)}`;
const wait = (ms: number) => new Promise(r => setTimeout(r,ms));
const store = { get(k:string) { try{return localStorage.getItem(k)}catch{return null} }, set(k:string,v:string) {try{localStorage.setItem(k,v)}catch{}}, remove(k:string) {try{localStorage.removeItem(k)}catch{}} };

export default function Demo() {
  const [product,setProduct] = useState<Product>('creator');
  const [session,setSession] = useState('');
  const [journey,setJourney] = useState<Journey|null>(null);
  const [step,setStep] = useState(0);
  const [count,setCount] = useState(10);
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [pending,setPending] = useState<{id:string,tx?:string}|null>(null);
  const [progress,setProgress] = useState('Preparando tu operación');
  const [notice,setNotice] = useState<{text:string,kind:string}|null>(null);
  const [visitor,setVisitor] = useState(0);
  const [source,setSource] = useState(1);
  const [visits,setVisits] = useState(0);
  const [visited,setVisited] = useState(false);
  const [lastConverted,setLastConverted] = useState<number|null>(null);
  const [drawer,setDrawer] = useState(false);
  const [chain,setChain] = useState<any>(null);
  const [chainError,setChainError] = useState('');
  const [chainLoading,setChainLoading] = useState(false);
  const [selectedCoupon,setSelectedCoupon] = useState<number|null>(null);
  const [confirmReset,setConfirmReset] = useState(false);
  const alive=useRef(true);
  const generation=useRef(0);
  const lastAction=useRef('');
  const mainRef=useRef<HTMLElement>(null);
  const isRef=product==='referral';
  const issued=journey?.issued||0, redeemed=journey?.redeemed||0, remaining=issued-redeemed;
  const name=people[visitor%people.length]+(visitor>=people.length?` ${Math.floor(visitor/people.length)+1}`:'');
  const coupon=journey?.coupons.find(c=>c.id===selectedCoupon);

  useEffect(()=>{
    alive.current=true;
    const p=new URLSearchParams(location.search).get('producto')==='referidos'?'referral':'creator';
    setProduct(p); void load(p);
    return ()=>{alive.current=false;generation.current++};
  },[]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(null),8500);return()=>clearTimeout(t)},[notice]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setDrawer(false);setSelectedCoupon(null);setConfirmReset(false)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);

  async function load(p:Product, fresh=false) {
    const gen=++generation.current;
    setLoading(true);setJourney(null);setNotice(null);setStep(0);setVisited(false);setVisits(0);setVisitor(0);setSource(1);setLastConverted(null);setPending(null);
    const key=`tt.session.${p}`;
    const id=fresh?crypto.randomUUID():store.get(key)||crypto.randomUUID();
    store.set(key,id);setSession(id);
    if(fresh){store.remove(`tt.pending.${p}`);store.remove(`tt.visitor.${p}`)}
    else setVisitor(Number(store.get(`tt.visitor.${p}`)||0));
    try {
      const r=await fetch(`/api/demo?session=${id}`);const data:any=await r.json();
      if(!r.ok)throw new Error(data.error||'No pudimos recuperar el recorrido');
      if(!alive.current||gen!==generation.current)return;
      setJourney(data.journey);setStep(currentStep(data.journey));
      if(data.journey)setCount(data.journey.count);
      if(data.pending){setBusy(true);setPending(data.pending);void track(data.pending.id,p).catch(e=>{setBusy(false);setNotice({kind:'error',text:String(e).replace('Error: ','')})})}
    }catch(e){if(gen===generation.current)setNotice({kind:'error',text:String(e).replace('Error: ','')})}
    finally{if(gen===generation.current)setLoading(false)}
  }
  async function track(id:string,p:Product):Promise<boolean> {
    for(let i=0;i<100;i++){
      if(!alive.current)return false;
      const r=await fetch(`/api/demo?job=${id}`);const data:any=await r.json();
      if(!r.ok){if(i<4){await wait(2000);continue}throw new Error(data.error||'No pudimos consultar la operación')}
      const job=data.job;
      if(job.tx){setPending({id,tx:job.tx});setProgress('Enviada a Sepolia. Esperando confirmación…')}
      if(job.status==='confirmed'){
        store.remove(`tt.pending.${p}`);setJourney(data.journey);setStep(currentStep(data.journey));setPending(null);setBusy(false);
        if(['redeem','bulk'].includes(lastAction.current))setLastConverted(visitor);
        setNotice({kind:'success',text:'Confirmado en Sepolia. El inventario ya está actualizado.'});return true;
      }
      if(job.status==='rejected'){
        store.remove(`tt.pending.${p}`);setPending(null);setBusy(false);
        setNotice({kind:'lesson',text:job.error?.message||'La operación fue rechazada antes de cambiar el inventario.'});return false;
      }
      await wait(2500);
    }
    setBusy(false);setNotice({kind:'error',text:'La confirmación sigue pendiente. Usa «Continuar seguimiento»; no necesitas repetir la operación.'});return false;
  }
  async function run(action:string,extra:Record<string,unknown>={}) {
    if(busy)return;
    setBusy(true);setNotice(null);lastAction.current=action;setProgress('Preparando y firmando tu operación…');
    const remembered=store.get(`tt.pending.${product}`);
    const body=remembered?JSON.parse(remembered):{session,product,count,action,requestId:crypto.randomUUID(),source,visitor:`person-${visitor}`,...extra};
    store.set(`tt.pending.${product}`,JSON.stringify(body));
    try{
      for(let i=0;i<100;i++){
        const r=await fetch('/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d:any=await r.json();
        if(r.status===409){setProgress('Otra persona está confirmando. Tu operación es la siguiente…');await wait(2500);continue}
        if(!r.ok||d.error){store.remove(`tt.pending.${product}`);setPending(null);setBusy(false);setNotice({kind:d.simulatedRejection?'lesson':'error',text:d.error?.message||d.error||'No se pudo enviar la operación.'});return}
        setPending(d.job);await track(d.job.id,product);return;
      }
      throw new Error('La red sigue ocupada. Tu operación quedó preparada; vuelve a pulsar para continuar.');
    }catch(e){setBusy(false);setNotice({kind:'error',text:String(e).replace('Error: ','')})}
  }
  function changeProduct(p:Product){if(busy||p===product)return;setProduct(p);history.replaceState(null,'',`?producto=${p==='referral'?'referidos':'cupones'}`);void load(p)}
  function nextPerson(){const n=visitor+1;setVisitor(n);store.set(`tt.visitor.${product}`,String(n));setVisited(false);setNotice(null)}
  function visit(s:number){setSource(s);setVisited(true);setVisits(v=>v+1);setNotice({kind:'info',text:`${name} abrió ${isRef?'el enlace de '+(s===1?'María':'Diego'):'el código de María'}. La visita aún no consume ningún cupón.`})}
  async function copyLink(){try{const u=new URL(location.href);u.searchParams.set('producto',isRef?'referidos':'cupones');await navigator.clipboard.writeText(u.toString());setNotice({kind:'success',text:'Enlace copiado. Cada compañero tendrá su propio recorrido.'})}catch{setNotice({kind:'info',text:'Puedes compartir la dirección de esta página desde tu navegador.'})}}
  async function readChain(){setChainLoading(true);setChainError('');try{const r=await fetch('/api/demo?network=1');const d:any=await r.json();if(!r.ok)throw new Error(d.error);setChain(d)}catch{setChainError('Sepolia no respondió. Puedes consultar el contrato directamente en el explorador.')}finally{setChainLoading(false)}}
  function openChain(){setDrawer(true);void readChain()}
  const primary=(label:string,action:()=>void,disabled=false)=><button className="button primary" disabled={disabled||busy||loading} onClick={action}>{busy?<LoaderCircle size={18} className="spin"/>:null}{label}{!busy&&<ArrowRight size={18}/>}</button>;
  const stepTitles=isRef?['Ponle un origen a cada registro.','Un inventario para cada referidor.','Ahora sí, abre las puertas.','Un enlace. Una nueva persona.','Ya sabes de dónde vinieron.']:['Todo empieza con una campaña.','Cada cupón nace con su propio ID.','Lo que emites, queda fijo.','Ponte del lado de quien lo usa.','Lo emitido nunca se pierde.'];
  const stepDescriptions=isRef?['María y Diego compartirán enlaces diferentes a la misma plataforma. Tú verás quién llevó cada conversión.','Los cupones se reparten por igual entre María y Diego, antes de que llegue el primer registro.','Activa la campaña para empezar a consumir los cupones. La cantidad emitida queda congelada.','Abre un enlace como visitante y completa el registro. Son dos momentos diferentes.','Las visitas las mide la aplicación. Los registros confirmados consumen cupones y quedan atribuidos en el contrato.']:['María compartirá MARIA10SALE. Ese código identifica su serie; cada canje consumirá un cupón distinto.','Emítelos antes de usarlos. La cantidad original y el ID de cada uno quedarán registrados en Sepolia.','Al activar, cierras la emisión definitivamente. Los canjes no vuelven a llenar el inventario.','Visita la campaña y confirma un canje. Verás qué ID se consume y cómo cambia el inventario.','El historial conserva los cupones emitidos, incluso después de consumirse. Puedes consultar cada transacción.'];

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="Tipper Tickets, inicio"><span className="brand-symbol">tt<span>·</span></span><span>tipper<span className="brand-light"> tickets</span></span></a><span className="lab-label">PLAYGROUND <span>01</span></span><div className="top-actions"><button className="network-button" onClick={openChain}><span className="status-dot"/>Sepolia real<ArrowUpRight size={14}/></button><button className="icon-button share" onClick={copyLink} aria-label="Compartir demo"><Copy size={17}/></button></div></header>
    <main ref={mainRef} className="page">
      <section className="intro"><div><div className="eyebrow"><span className="tiny-line"/> APRENDE HACIÉNDOLO</div><h1>De un enlace a <span>algo que cuenta.</span></h1><p>Dos productos. Un inventario transparente. Pruébalos paso a paso.</p></div><div className="intro-note"><Sparkles size={18}/><span>Sin wallet. Sin registro.<br/><strong>Transacciones reales, gas patrocinado.</strong></span></div></section>
      <nav className="product-nav" aria-label="Productos"><button className={!isRef?'selected':''} aria-pressed={!isRef} disabled={busy} onClick={()=>changeProduct('creator')}><Ticket size={19}/><span>Cupones de creadores<small>De un código a un canje</small></span><span className="product-number">01</span></button><button className={isRef?'selected':''} aria-pressed={isRef} disabled={busy} onClick={()=>changeProduct('referral')}><Link2 size={19}/><span>Enlaces de referral<small>De una visita a un registro</small></span><span className="product-number">02</span></button><div className="reset-area"><button className="text-button" disabled={busy||!journey} onClick={()=>setConfirmReset(true)}><RotateCcw size={14}/>Nuevo recorrido</button></div></nav>
      <div className="workspace">
        <section className="guide-panel">
          <nav className="steps" aria-label="Pasos del recorrido">{STEP_NAMES.map((s,i)=><button key={s} disabled={busy||loading||i>currentStep(journey)&&(i!==4||!redeemed)} onClick={()=>setStep(i)} className={`${step===i?'current':''} ${i<currentStep(journey)?'done':''}`} aria-current={step===i?'step':undefined}><span>{i<currentStep(journey)?<Check size={13}/>:String(i+1).padStart(2,'0')}</span><b>{s}</b></button>)}</nav>
          <div className="guide-content" key={`${product}-${step}`}><div className="step-caption">PASO {String(step+1).padStart(2,'0')} <span>/ 05</span></div><h2>{stepTitles[step]}</h2><p className="step-description">{stepDescriptions[step]}</p>
          {loading?<div className="loading-state"><LoaderCircle className="spin" size={24}/><p>Preparando tu recorrido…</p></div>:<>
          {step===0&&<><div className="config-card"><div className="config-top"><span className="avatar">M</span><div><strong>{isRef?'María + Diego':'Campaña de María'}</strong><p>{isRef?'Dos enlaces, una misma plataforma':'Código público: MARIA10SALE'}</p></div>{isRef?<span className="avatar secondary">D</span>:<span className="mini-badge">CREADOR</span>}</div><label>¿Con cuántos cupones quieres probar?</label><div className="count-options">{[10,20,50].map(n=><button aria-pressed={count===n} key={n} disabled={busy||!!journey?.campaign} className={count===n?'chosen':''} onClick={()=>setCount(n)}><b>{n}</b><span>cupones</span>{count===n&&<Check size={13}/>}</button>)}</div><div className="config-bottom"><span>Tope de campaña <b>100</b></span><span>{isRef?`${count/2} para cada referidor`:'Todos asociados a María'}</span></div></div><div className="hint"><CircleHelp size={16}/><p>El tope es el máximo permitido. La cantidad que emitas será tu inventario real.</p></div><div className="actions">{journey?.campaign?primary('Continuar',()=>setStep(currentStep(journey))):primary('Crear mi campaña',()=>run('create'))}<span className="action-note">{journey?.campaign?`Campaña #${journey.campaign}`:'Primera transacción en Sepolia'}</span></div></>}
          {step===1&&<><div className="issue-layout"><div className="large-ticket"><div className="ticket-top"><span>TIPPER TICKETS</span><Ticket size={18}/></div><strong>{isRef?'REFERRAL':'MARIA10SALE'}</strong><div className="ticket-rule"/><div className="ticket-bottom"><span>{isRef?'1 registro confirmado':'1 canje'}<small>Un solo uso por ID</small></span><code>ID ÚNICO</code></div><div className="punch left"/><div className="punch right"/></div><div className="issue-equation"><b>{journey?.count||count}</b><span>cupones individuales<br/>en este lote</span></div></div><div className="hint"><Layers3 size={16}/><p>{isRef?'Cada ID pertenece a María o a Diego desde su emisión.':'MARIA10SALE es el código compartido. Los cupones que hay detrás tienen IDs diferentes.'}</p></div><div className="actions">{issued?primary('Ver inventario emitido',()=>setStep(currentStep(journey))):primary(`Emitir ${count} cupones reales`,()=>run('issue'))}<span className="action-note">{issued?'Emisión completada':'Los IDs aparecerán a la derecha'}</span></div></>}
          {step===2&&<><div className="freeze-visual"><div className="freeze-numbers"><div><strong>100</strong><span>Tope permitido</span></div><ArrowRight size={20}/><div><strong>{issued}</strong><span>Emisión real</span></div><LockKeyhole size={24}/></div><div className="freeze-message"><CheckCheck size={17}/><p>Al activar, <b>{issued} será el total emitido</b> de esta campaña. Los otros {100-issued} nunca se emitieron.</p></div></div><div className="hint"><CircleHelp size={16}/><p>Activar habilita los canjes y cierra nuevas emisiones. No puedes volver a borrador.</p></div><div className="actions">{journey?.status==='active'?primary('Ir a probar',()=>setStep(3)):primary('Activar y congelar inventario',()=>run('activate'))}</div></>}
          {step===3&&<><div className="visitor-toolbar"><span className="visitor-label"><span className="avatar small">{name[0]}</span>Estás probando como <b>{name}</b></span><button className="text-button" disabled={busy} onClick={nextPerson}>Otra persona<Plus size={14}/></button></div><div className="experience"><div className="browser-bar"><i/><i/><i/><span>{visited?'tipper · '+(isRef?'registro':'canje'):'Vista del visitante'}</span><MousePointer2 size={13}/></div>
          {isRef?<div className="referral-experience"><span className="mini-eyebrow">1. ELIGE POR DÓNDE LLEGAR</span><div className="referral-links">{[1,2].map(s=><button key={s} className={source===s&&visited?'active-link':''} onClick={()=>visit(s)} disabled={busy}><span className={`avatar ${s===2?'secondary':''}`}>{s===1?'M':'D'}</span><span><b>Enlace de {s===1?'María':'Diego'}</b><small>tipper / ?ref={s===1?'maria':'diego'}</small></span><ArrowUpRight size={17}/></button>)}</div><div className="conversion-box"><span className="mini-eyebrow">2. CONFIRMA LA CONVERSIÓN</span><div><span>{visited?`${name} llegó por ${source===1?'María':'Diego'}`:'Primero abre uno de los enlaces'}</span><button disabled={!visited||busy||!remaining} onClick={()=>run('redeem')}><Check size={14}/>Completar registro</button></div></div></div>:<div className="creator-experience"><div className="promo-copy"><span className="mini-eyebrow">MARÍA LO COMPARTE. TÚ LO PRUEBAS.</span><h3>Un código.<br/><em>{remaining} oportunidades.</em></h3><button className="code-copy" disabled={busy} onClick={()=>visit(1)}>MARIA10SALE <ArrowUpRight size={16}/></button><p>{visited?`${name} ya abrió la campaña. Ahora confirma el canje.`:'Pulsa el código para llegar como visitante.'}</p></div><div className="consumer-ticket"><Ticket size={25}/><span>TU CUPÓN</span><strong>1 canje</strong><div className="ticket-dashes"/><button disabled={!visited||busy||!remaining} onClick={()=>run('redeem')}>Usar mi cupón<ArrowRight size={14}/></button></div></div>}
          </div><div className="visit-note"><MousePointer2 size={14}/><span><b>{visits}</b> {visits===1?'visita':'visitas'} en este navegador</span><span className="separator-dot"/><span>Los clics no consumen cupones</span></div>
          {redeemed>0&&<div className="try-again"><span>{isRef?`¿${name} se registra desde otro enlace?`:'¿Y si uso el mismo cupón otra vez?'}</span><button disabled={busy} onClick={()=>isRef?(visit(source===1?2:1),setNotice({kind:'info',text:'El enlace cambió. Vuelve a pulsar «Completar registro» con la misma persona para ver qué ocurre.'})):run('repeat')}>Probar<ArrowUpRight size={13}/></button></div>}
          <div className="actions split">{primary('Ver resultados',()=>setStep(4),!redeemed)}{!isRef&&remaining>0&&<button disabled={busy} className="text-button" onClick={()=>run('bulk',{amount:Math.min(20,remaining)})}>Canjear {Math.min(20,remaining)} de una vez<Layers3 size={14}/></button>}</div></>}
          {step===4&&<><div className="results-banner"><span className="success-mark"><CheckCheck size={25}/></span><div><strong>Lo acabas de probar en la red.</strong><p>{redeemed} {redeemed===1?'cupón consumido':'cupones consumidos'}, sin perder el historial.</p></div></div><div className="result-math"><div><b>{issued}</b><span>Emitidos</span></div><span>−</span><div><b>{redeemed}</b><span>Consumidos</span></div><span>=</span><div className="remaining-result"><b>{remaining}</b><span>Sin consumir</span></div></div><div className="attribution"><span className="mini-eyebrow">{isRef?'¿QUIÉN TRAJO LAS CONVERSIONES?':'ATRIBUCIÓN DE LOS CANJES'}</span>{(journey?.series||[]).map(s=>{const n=journey!.coupons.filter(c=>c.series===s.id&&c.used).length;return <div className="attribution-row" key={s.id}><span className={`avatar small ${s.id===2?'secondary':''}`}>{s.name[0]}</span><b>{s.name}</b><div className="bar-track"><i style={{width:`${redeemed?Math.max(n/redeemed*100,2):0}%`}}/></div><strong>{n}</strong></div>})}</div><div className="hint"><CheckCheck size={16}/><p>{isRef?'Cada conversión tiene un origen. La misma referencia no se puede atribuir dos veces, aunque cambie el enlace.':'Un cupón se consume una vez. Los consumidos conservan su ID y siguen contando en el total emitido.'}</p></div><div className="actions split">{primary(isRef?'Probar cupones de creadores':'Probar referrals',()=>changeProduct(isRef?'creator':'referral'))}<button className="text-button" disabled={busy} onClick={()=>setStep(3)}>Seguir canjeando<ArrowLeft size={14}/></button></div></>}
          </>}
          </div>
          <div className="guide-footer"><span><Radio size={13}/> Todo ocurre en Starknet Sepolia</span><button onClick={openChain}>Ver contrato<ArrowUpRight size={13}/></button></div>
        </section>

        <aside className="inventory-panel"><div className="inventory-heading"><div><span className="eyebrow">TU CAMPAÑA EN VIVO</span><h3>El inventario</h3></div><span className={`state-pill ${journey?.status==='active'?'live':''}`}><span/>{journey?.status==='active'?'Activa':journey?.campaign?'Borrador':'Por crear'}</span></div><div className="inventory-stats"><div><b key={issued}>{issued}</b><span>Emitidos</span></div><div><b key={redeemed}>{redeemed}</b><span>Consumidos</span></div><div className="available"><b key={remaining}>{remaining}</b><span>Sin consumir</span></div></div>
          <div className="coupon-canvas"><div className="canvas-label"><span>{journey?.campaign?`CAMPAÑA #${journey.campaign}`:'ASÍ SE VERÁ TU INVENTARIO'}</span><span>{issued?`${issued} IDs únicos`:`${count} por emitir`}</span></div><div className={`ticket-grid ${count>20?'dense':''}`} aria-label="Cupones de la campaña">{(journey?.coupons.length?journey.coupons:Array.from({length:count},(_,i)=>({id:i+1,series:1,used:false}))).map((c,i)=><button key={c.id} disabled={!issued} onClick={()=>setSelectedCoupon(c.id)} className={`mini-ticket ${!issued?'ghost':c.used?'burned':'fresh'} ${c.series===2?'source-b':''}`} title={issued?`Cupón #${c.id}, ${c.used?'consumido':'sin consumir'}`:'Pendiente de emisión'} aria-label={issued?`Cupón ${c.id}, ${c.used?'consumido':'sin consumir'}`:`Vista previa ${i+1}`} style={{'--i':i} as React.CSSProperties}>{c.used?<Check size={count>20?11:15}/>:<Ticket size={count>20?13:19}/>}<span>{issued?`#${c.id}`:'—'}</span></button>)}</div><div className="canvas-legend"><span><i className="fresh-dot"/>Sin consumir</span><span><i className="burn-dot"/>Consumido</span><small>{issued?'Pulsa un ID para verlo':'Los IDs se asignan al emitir'}</small></div></div>
          {busy&&<div className="pending-box" role="status"><LoaderCircle size={18} className="spin"/><div><strong>Una acción, una transacción</strong><p>{progress}</p>{pending?.tx&&<a href={`${EXPLORER}/tx/${pending.tx}`} target="_blank" rel="noreferrer">Ver transacción<ArrowUpRight size={12}/></a>}</div></div>}
          {!busy&&pending&&<button className="button secondary follow" onClick={()=>{setBusy(true);void track(pending.id,product).catch(e=>{setBusy(false);setNotice({kind:'error',text:String(e)})})}}>Continuar seguimiento<ArrowRight size={14}/></button>}
          <div className="activity"><div className="activity-heading"><h4>Lo que queda registrado</h4><span>{journey?.history.length||0}</span></div>{!journey?.history.length?<div className="activity-empty"><span className="empty-node"/><div>Tu primera acción empieza la historia.<small>Cada confirmación aparecerá aquí.</small></div></div>:<ol>{[...journey.history].reverse().map((a,i)=><li key={a.tx}><span className="activity-node"><Check size={10}/></span><div><strong>{a.label}</strong><span>{new Date(a.at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})} · Confirmada en Sepolia</span></div><a href={`${EXPLORER}/tx/${a.tx}`} target="_blank" rel="noreferrer" aria-label={`Ver transacción: ${a.label}`}><ArrowUpRight size={15}/></a></li>)}</ol>}</div>
          <div className="inventory-footnote"><span className="small-logo">tt.</span><p>{isRef?'El registro confirmado cuenta. El clic, por sí solo, no.':'El código identifica a María. Cada ID representa un canje.'}</p></div>
        </aside>
      </div>
      <footer className="page-footer"><span>TIPPER TICKETS <i>×</i> STARKNET</span><span>Prueba libre · Solo tokens de testnet · Campañas de 7 días</span><button onClick={copyLink}>Compártelo con el equipo<ArrowUpRight size={13}/></button></footer>
    </main>
    {notice&&<div className={`toast ${notice.kind}`} role="status"><span>{notice.kind==='success'?<CheckCheck size={20}/>:notice.kind==='lesson'?<CircleHelp size={20}/>:<Radio size={19}/>}</span><p>{notice.text}</p><button aria-label="Cerrar aviso" onClick={()=>setNotice(null)}><X size={16}/></button></div>}
    {drawer&&<div className="modal-backdrop" onClick={()=>setDrawer(false)}><section className="network-modal" role="dialog" aria-modal="true" aria-label="Contrato real en Sepolia" onClick={e=>e.stopPropagation()}><button className="close-modal" onClick={()=>setDrawer(false)} aria-label="Cerrar contrato"><X/></button><span className="eyebrow"><span className="status-dot"/> LECTURA REAL DE SEPOLIA</span><h2>Todo se puede comprobar.</h2><p>Esta demo usa el contrato BurnLedger ya desplegado. Las campañas de cada recorrido son independientes.</p><a className="contract-address" href={`${EXPLORER}/contract/${CONTRACT}`} target="_blank" rel="noreferrer"><code>{shortHash(CONTRACT)}</code><ExternalLink size={17}/></a><div className="network-examples"><h4>Las primeras campañas desplegadas</h4>{chainLoading?<p><LoaderCircle size={15} className="spin"/> Consultando el contrato…</p>:chain?<>{[['Cupones de María',chain.creator],['Referrals A y B',chain.referral]].map(([title,c]:any)=><div key={title}><span>{title}<small>Campaña #{c.id}</small></span><b>{c.issued}<small>emitidos</small></b><b>{c.redeemed}<small>consumidos</small></b></div>)}<p className="read-time">Leído ahora · {new Date(chain.checkedAt).toLocaleTimeString('es')}</p></>:<p>{chainError}</p>}</div><div className="hint"><CircleHelp size={16}/><p>Una transacción demuestra lo que registró el operador. La aplicación confirma que ocurrió el canje o el registro.</p></div><button className="button secondary" onClick={readChain} disabled={chainLoading}><RotateCcw size={15}/>Actualizar lectura</button></section></div>}
    {coupon&&<div className="modal-backdrop" onClick={()=>setSelectedCoupon(null)}><section className="coupon-modal" role="dialog" aria-modal="true" aria-label={`Cupón ${coupon.id}`} onClick={e=>e.stopPropagation()}><button className="close-modal" onClick={()=>setSelectedCoupon(null)} aria-label="Cerrar cupón"><X/></button><Ticket size={34}/><span className="eyebrow">ID REAL · SEPOLIA</span><h2>Cupón #{coupon.id}</h2><div className="coupon-details"><span>Origen<b>{coupon.series===1?'María':'Diego'}</b></span><span>Campaña<b>#{journey?.campaign}</b></span><span>Estado<b>{coupon.used?'Consumido':'Sin consumir'}</b></span></div><p>{coupon.used?'Ya se utilizó. El registro conserva su ID y su origen.':'Fue emitido antes de activar. Puede consumirse una sola vez mientras la campaña esté vigente.'}</p><a className="button secondary" href={`${EXPLORER}/contract/${CONTRACT}`} target="_blank" rel="noreferrer">Consultar contrato<ArrowUpRight size={16}/></a></section></div>}
    {confirmReset&&<div className="modal-backdrop" onClick={()=>setConfirmReset(false)}><section className="reset-modal" role="dialog" aria-modal="true" aria-label="Nuevo recorrido" onClick={e=>e.stopPropagation()}><span className="eyebrow">OTRA VUELTA</span><h2>Una nueva campaña,<br/>desde el principio.</h2><p>Tu campaña anterior seguirá en Sepolia. Empezar otro recorrido no borra su historial ni recupera los cupones consumidos.</p><div className="actions"><button className="button primary" onClick={()=>{setConfirmReset(false);void load(product,true)}}>Empezar de nuevo<ArrowRight size={16}/></button><button className="text-button" onClick={()=>setConfirmReset(false)}>Seguir aquí</button></div></section></div>}
  </div>
}
