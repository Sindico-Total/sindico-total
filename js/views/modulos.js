import { sb } from '../supabase.js';
import { esc, q, toast, hojeISO, data } from '../ui.js';
import { state, ehAdmin, condAtual, recarregar } from '../app.js';

export const catalogo = { comunicados:'Comunicados', documentos:'Documentos', reservas:'Reservas de espaços' };
const btn = (txt, attr='') => '<button type="button" class="btn" '+attr+'>'+esc(txt)+'</button>';
const opts = (items, label) => items.map(x=>'<option value="'+esc(x.id)+'">'+esc(label(x))+'</option>').join('');
function action(el, fn) {
  el.onclick = async () => { el.disabled=true; try { await fn(); } catch(e) { toast(e.message || 'Falha na operação','erro'); } finally { el.disabled=false; } };
}
function form(el, fn) {
  el.onsubmit = async e => { e.preventDefault(); const b=el.querySelector('button[type=submit]'); b.disabled=true; try { await fn(new FormData(el)); } catch(e) { toast(e.message || 'Falha na operação','erro'); } finally { b.disabled=false; } };
}
export async function configuracao(root) {
  if (!ehAdmin()) return;
  const c=condAtual();
  if (!c) { root.textContent='Selecione um condomínio na área de gestão.'; return; }
  const rows=await q(sb.from('condominio_modulos').select('modulo,habilitado').eq('condominio_id',c.id));
  root.innerHTML='<div class="card"><h2>'+esc(c.nome_fantasia)+'</h2><p>Ative os serviços deste condomínio. Desativar preserva os registros.</p><form>'+Object.entries(catalogo).map(([k,v])=>'<p><label><input type="checkbox" name="modulo" value="'+k+'" '+(rows.some(r=>r.modulo===k&&r.habilitado)?'checked':'')+'> '+esc(v)+'</label></p>').join('')+'<button type="submit" class="btn">Salvar configuração</button></form></div>';
  form(root.querySelector('form'),async d=>{await q(sb.rpc('configurar_modulos',{p_condominio:c.id,p_modulos:d.getAll('modulo')}));toast('Módulos atualizados');await recarregar();});
}
async function contexto(root,mod,gestao,render) {
  const cs=gestao ? [condAtual()].filter(Boolean) : [...new Map(state.unidades.map(v=>v.unidades?.condominios).filter(Boolean).map(c=>[c.id,c])).values()];
  const ids=cs.filter(c=>state.modulos?.some(m=>m.condominio_id===c.id&&m.modulo===mod&&m.habilitado));
  if(!ids.length){root.textContent='Módulo indisponível neste condomínio.';return;}
  root.innerHTML='<div class="card"><label>Condomínio <select aria-label="Condomínio">'+opts(ids,c=>c.nome_fantasia)+'</select></label></div><div data-corpo></div>';
  const sel=root.querySelector('select'), corpo=root.querySelector('[data-corpo]');
  const atualizar=async()=>{const id=sel.value;const sub=document.createElement('div');corpo.replaceChildren(sub);try{await render(sub,id,gestao,atualizar);}catch(e){sub.textContent='Não foi possível carregar: '+e.message;}};
  sel.onchange=atualizar;await atualizar();
}
async function avisos(root,id,g,refresh){
  const rows=await q(sb.from('comunicados').select('*').eq('condominio_id',id).order('publicado_em',{ascending:false}));
  root.innerHTML=(g?'<div class="card"><h3>Novo comunicado</h3><form><label>Título<input required name="titulo" maxlength="120"></label><label>Mensagem<textarea required name="mensagem" maxlength="4000"></textarea></label><button type="submit" class="btn">Publicar</button></form></div>':'')+rows.map((r,i)=>'<div class="card"><h3>'+esc(r.titulo)+'</h3><p style="white-space:pre-wrap">'+esc(r.mensagem)+'</p><small>'+esc(data(r.publicado_em))+'</small>'+(g?btn(r.ativo?'Arquivar':'Reativar','data-item="'+i+'"'):'')+'</div>').join('')+(!rows.length?'<div class="card">Nenhum comunicado.</div>':'');
  if(g){form(root.querySelector('form'),async d=>{await q(sb.from('comunicados').insert({condominio_id:id,titulo:d.get('titulo'),mensagem:d.get('mensagem')}));await refresh();});root.querySelectorAll('[data-item]').forEach(b=>action(b,async()=>{const r=rows[Number(b.dataset.item)];await q(sb.from('comunicados').update({ativo:!r.ativo}).eq('id',r.id));await refresh();}));}
}
async function docs(root,id,g,refresh){
  const rows=await q(sb.from('documentos_condominio').select('*').eq('condominio_id',id).order('publicado_em',{ascending:false}));
  root.innerHTML=(g?'<div class="card"><h3>Novo documento PDF</h3><form><label>Título<input name="titulo" maxlength="120" required></label><label>Categoria<select name="categoria">'+['Convenção','Regimento','Ata','Circular','Outros'].map(c=>'<option>'+c+'</option>').join('')+'</select></label><label>Arquivo<input type="file" name="pdf" accept="application/pdf" required></label><button type="submit" class="btn">Enviar e publicar</button></form></div>':'')+rows.map((r,i)=>'<div class="card"><h3>'+esc(r.titulo)+'</h3><p>'+esc(r.categoria)+'</p>'+btn('Baixar PDF','data-download="'+i+'"')+(g?btn(r.ativo?'Arquivar':'Publicar','data-toggle="'+i+'"'):'')+'</div>').join('')+(!rows.length?'<div class="card">Nenhum documento.</div>':'');
  root.querySelectorAll('[data-download]').forEach(b=>action(b,async()=>{const r=rows[Number(b.dataset.download)];const blob=await q(sb.storage.from('documentos-condominio').download(r.arquivo));const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=r.titulo+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
  if(g){form(root.querySelector('form'),async d=>{const pdf=d.get('pdf');if(pdf.type!=='application/pdf'||pdf.size>10485760)throw Error('Envie um PDF de até 10 MB.');const r=await q(sb.from('documentos_condominio').insert({condominio_id:id,titulo:d.get('titulo'),categoria:d.get('categoria')}).select().single());await q(sb.storage.from('documentos-condominio').upload(r.arquivo,pdf,{contentType:'application/pdf'}));await q(sb.from('documentos_condominio').update({ativo:true}).eq('id',r.id));await refresh();});root.querySelectorAll('[data-toggle]').forEach(b=>action(b,async()=>{const r=rows[Number(b.dataset.toggle)];await q(sb.from('documentos_condominio').update({ativo:!r.ativo}).eq('id',r.id));await refresh();}));}
}
const hora=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const minutos=s=>{const [h,m]=s.split(':').map(Number);return h*60+m;};
async function reservas(root,id,g,refresh){
 const [espacos,rs]=await Promise.all([q(sb.from('espacos_condominio').select('*').eq('condominio_id',id).order('nome')),q(sb.from('reservas_condominio').select('*').eq('condominio_id',id).order('dia',{ascending:false}).limit(100))]);
 const unidades=state.unidades.map(v=>v.unidades).filter(u=>u?.condominio_id===id);
 const ativos=espacos.filter(e=>e.ativo);
 root.innerHTML=(g?'<div class="card"><h3>Cadastrar espaço</h3><form data-espaco><label>Nome<input name="nome" maxlength="100" required></label><label>Regras<textarea name="regras" maxlength="1500"></textarea></label><label>Abertura<input name="abertura" type="time" value="08:00" required></label><label>Fechamento<input name="fechamento" type="time" value="22:00" required></label><label>Duração<select name="duracao">'+[30,60,90,120,180,240,480].map(n=>'<option value="'+n+'">'+n+' min</option>').join('')+'</select></label><label>Antecedência em dias<input name="antecedencia_dias" type="number" min="1" max="90" value="30" required></label><button type="submit" class="btn">Cadastrar</button></form>'+espacos.map((e,i)=>'<p>'+esc(e.nome)+' '+btn(e.ativo?'Desativar':'Ativar','data-esp="'+i+'"')+'</p>').join('')+'</div>':'')+
 (ativos.length&&(g||unidades.length)?'<div class="card"><h3>'+(g?'Bloquear horário':'Reservar espaço')+'</h3><form data-reserva><label>Espaço<select name="espaco">'+opts(ativos,e=>e.nome)+'</select></label><p data-regras></p><label>Dia<input name="dia" type="date" min="'+hojeISO()+'" value="'+hojeISO()+'" required></label><label>Horário<select name="inicio" required></select></label>'+(!g?'<label>Unidade<select name="unidade">'+opts(unidades,u=>u.identificacao)+'</select></label><label><input type="checkbox" required> Li e aceito as regras</label>':'')+'<button type="submit" class="btn">Confirmar</button></form></div>':'<div class="card">Nenhum espaço disponível.</div>')+
 '<div class="card"><h3>Histórico</h3>'+rs.map((r,i)=>'<p>'+esc(espacos.find(e=>e.id===r.espaco_id)?.nome||'Espaço')+' · '+esc(data(r.dia))+' · '+hora(r.inicio)+'–'+hora(r.fim)+(r.cancelada_em?' · Cancelada':btn('Cancelar','data-cancel="'+i+'"'))+'</p>').join('')+'</div>';
 if(g){form(root.querySelector('[data-espaco]'),async d=>{await q(sb.from('espacos_condominio').insert({condominio_id:id,nome:d.get('nome'),regras:d.get('regras'),abertura:minutos(d.get('abertura')),fechamento:minutos(d.get('fechamento')),duracao:Number(d.get('duracao')),antecedencia_dias:Number(d.get('antecedencia_dias'))}));await refresh();});root.querySelectorAll('[data-esp]').forEach(b=>action(b,async()=>{const e=espacos[Number(b.dataset.esp)];await q(sb.from('espacos_condominio').update({ativo:!e.ativo}).eq('id',e.id));await refresh();}));}
 const f=root.querySelector('[data-reserva]');
 if(f){let seq=0;const carregar=async()=>{const n=++seq;const e=ativos.find(e=>e.id===f.elements.espaco.value),dia=f.elements.dia.value;f.elements.inicio.replaceChildren();f.querySelector('[data-regras]').textContent=e.regras; if(!dia)return;try{const ocup=await q(sb.rpc('horarios_ocupados',{p_espaco:e.id,p_dia:dia}));if(n!==seq)return;for(let m=e.abertura;m+e.duracao<=e.fechamento;m+=e.duracao){if(!ocup.some(o=>m<o.fim&&m+e.duracao>o.inicio))f.elements.inicio.add(new Option(hora(m),m));}}catch(err){toast(err.message,'erro');}};f.elements.espaco.onchange=carregar;f.elements.dia.onchange=carregar;await carregar();form(f,async d=>{if(d.get('inicio')==null||d.get('inicio')==='')throw Error('Sem horário disponível');await q(sb.rpc('criar_reserva',{p_espaco:d.get('espaco'),p_dia:d.get('dia'),p_inicio:Number(d.get('inicio')),p_unidade:g?null:d.get('unidade'),p_bloqueio:g}));await refresh();});}
 root.querySelectorAll('[data-cancel]').forEach(b=>action(b,async()=>{const ok=await q(sb.rpc('cancelar_reserva',{p_reserva:rs[Number(b.dataset.cancel)].id}));if(!ok)throw Error('Reserva não pode ser cancelada.');await refresh();}));
}
export const tela=(mod,g=false)=>root=>contexto(root,mod,g,{comunicados:avisos,documentos:docs,reservas}[mod]);
