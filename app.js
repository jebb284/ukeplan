/* Ukeplan – Maskin og Teknikk
   A small installable web app. Data, logins and access rules live in Supabase (see oppsett.sql).
   The page keeps a copy of the plan in this browser so it opens instantly and can be read offline. */
(function(){
  'use strict';
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DAGER=['Mandag','Tirsdag','Onsdag','Torsdag','Fredag','Lørdag','Søndag'];
  const KORT=['Man','Tir','Ons','Tor','Fre','Lør','Søn'];
  const MND=['jan.','feb.','mars','apr.','mai','juni','juli','aug.','sep.','okt.','nov.','des.'];
  const TYPER={verksted:'Verksted',butikk:'Butikk og kunder',levering:'Levering og henting',bestilling:'Bestilling',annet:'Annet'};
  const TYPEFARGE={verksted:'var(--t-verksted)',butikk:'var(--t-butikk)',levering:'var(--t-levering)',bestilling:'var(--t-bestilling)',annet:'var(--t-annet)'};
  const UKER_TILBAKE=16;
  const lsHent=k=>{try{return localStorage.getItem(k)}catch(e){return null}}, lsSett=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}}, lsFjern=k=>{try{localStorage.removeItem(k)}catch(e){}};

  // ---------- screens ----------
  const SKJERMER=['skjerm-oppsett','skjerm-login','skjerm-ingen','app'];
  function vis(id){SKJERMER.forEach(s=>{const e=document.getElementById(s);if(e)e.hidden=s!==id})}

  // ---------- dates (ISO weeks, Norway) ----------
  function osloIdag(){let d;try{d=new Date(new Date().toLocaleString('en-US',{timeZone:'Europe/Oslo'}))}catch(e){d=new Date()}d.setHours(0,0,0,0);return d}
  function mandagFor(d){const x=new Date(d);const wd=(x.getDay()+6)%7;x.setDate(x.getDate()-wd);x.setHours(0,0,0,0);return x}
  function ukeId(man){const t=new Date(man);t.setDate(t.getDate()+3);const y=t.getFullYear();const fm=mandagFor(new Date(y,0,4));const n=1+Math.round((mandagFor(t)-fm)/(7*864e5));return `${y}-W${String(n).padStart(2,'0')}`}
  const ukeNr=id=>parseInt(id.split('-W')[1],10);
  let idag=osloIdag();
  let mandag=mandagFor(idag);
  const datoFor=i=>{const d=new Date(mandag);d.setDate(d.getDate()+i);return d};
  const grenseUke=()=>{const g=mandagFor(idag);g.setDate(g.getDate()-7*UKER_TILBAKE);return ukeId(g)};

  // ---------- state ----------
  let sb=null, meEpost=null, meg=null, lastet=false, nett=navigator.onLine, feilTekst='';
  const TOM=()=>({ansatte:[],faste:[],oppgaver:[],uker:[],ferdig_faste:[],hopp_over:[],endringer:[],timer:[],foresporsler:[]});
  let D=TOM();
  let person=lsHent('ukeplan-person')||'';
  let valgtDag=Math.min((idag.getDay()+6)%7,4);
  let redigererNotat=false;

  const navnFor=e=>{if(!e)return '';if(e==='system')return 'Oppsett';const a=D.ansatte.find(x=>x.email===e);return a?a.navn:e.split('@')[0]};
  const ukeRad=id=>D.uker.find(u=>u.uke===id)||{uke:id,notat:''};
  const erAdmin=()=>!!(meg&&meg.admin);
  const kanSkrive=()=>lastet&&nett&&!!meg;

  function naar(ts){
    if(!ts)return '';const d=new Date(ts);if(isNaN(d))return '';
    const dato=x=>{try{return x.toLocaleDateString('sv-SE',{timeZone:'Europe/Oslo'})}catch(e){return x.toDateString()}};
    let kl;try{kl=d.toLocaleTimeString('nb-NO',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Oslo'})}catch(e){kl=d.toTimeString().slice(0,5)}
    if(dato(d)===dato(new Date()))return 'i dag '+kl;
    if(dato(d)===dato(new Date(Date.now()-864e5)))return 'i går '+kl;
    try{return d.toLocaleDateString('nb-NO',{weekday:'short',day:'numeric',month:'short',timeZone:'Europe/Oslo'})+' '+kl}catch(e){return kl}
  }
  function attrTekst(o){
    if(o.ferdig&&o.ferdig_av)return `Ferdig – ${navnFor(o.ferdig_av)}${o.ferdig_tid?', '+naar(o.ferdig_tid):''}`;
    if(o.endret_av&&o.endret&&o.opprettet&&Math.abs(new Date(o.endret)-new Date(o.opprettet))>2000)return `Endret av ${navnFor(o.endret_av)} · ${naar(o.endret)}`;
    if(o.av&&o.av!=='system')return `Lagt til av ${navnFor(o.av)}${o.opprettet?' · '+naar(o.opprettet):''}`;
    return '';
  }

  // tasks for one day: this week's one-off tasks + recurring tasks (dag -1 = every weekday)
  function oppgaverFor(i){
    const id=ukeId(mandag);
    const hopp=new Set(D.hopp_over.filter(h=>h.uke===id&&h.dag===i).map(h=>h.fast_id));
    const enkle=D.oppgaver.filter(o=>o.uke===id&&o.dag===i).map(o=>({...o,fast:false}));
    const fs=D.faste.filter(f=>(f.dag===i||(f.dag===-1&&i<5))&&!hopp.has(f.id)).map(f=>{const k=D.ferdig_faste.find(x=>x.uke===id&&x.fast_id===f.id&&x.dag===i);return {...f,dag:i,fast:true,ferdig:!!k,ferdig_av:k&&k.av,ferdig_tid:k&&k.tid}});
    return [...enkle,...fs].filter(o=>!person||o.ansvarlig===person||!o.ansvarlig).sort((a,b)=>(a.tid||'99').localeCompare(b.tid||'99')||String(a.tittel).localeCompare(String(b.tittel),'nb'));
  }

  // ---------- render ----------
  const ikonHake='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 8.5l3.2 3.2L13 5"/></svg>';
  function render(){
    if($('#app').hidden)return;
    tegnSeksjoner();
    const id=ukeId(mandag), fre=datoFor(4), u=ukeRad(id), skriv=kanSkrive();
    $('#ukenr').textContent='Uke '+ukeNr(id)+(ukeId(mandagFor(idag))===id?' · denne uken':'');
    $('#ukedatoer').textContent=`${datoFor(0).getDate()}. ${datoFor(0).getMonth()!==fre.getMonth()?MND[datoFor(0).getMonth()]+' ':''}– ${fre.getDate()}. ${MND[fre.getMonth()]} ${fre.getFullYear()}`;
    $('#meg').innerHTML=meg?`<span>Du er</span> <b>${esc(meg.navn)}</b>`:'Konto';
    $('#nett').hidden=nett;
    tegnBannere();
    // week message (left alone while someone is typing in it)
    if(!redigererNotat){
      const n=$('#notat');
      const av=u.notat&&u.notat_av?`<small class="av">Skrevet av ${esc(navnFor(u.notat_av))} · ${esc(naar(u.notat_tid))}</small>`:'';
      n.innerHTML=`<span class="etikett">Beskjed</span><div class="notat-tekst"><p class="${u.notat?'':'tom'}">${u.notat?esc(u.notat):'Ingen beskjed for denne uken.'}</p>${av}</div>${skriv?'<button class="knapp" type="button" id="notat-rediger">Endre</button>':''}`;
    }
    // people filter
    const navn=D.ansatte.map(a=>a.navn);
    if(person&&lastet&&!navn.includes(person))person='';
    $('#personer').innerHTML=navn.length>1?[`<button class="chip" type="button" data-person="" aria-pressed="${!person}">Alle</button>`,...navn.map(p=>`<button class="chip" type="button" data-person="${esc(p)}" aria-pressed="${person===p}">${esc(p)}</button>`)].join(''):'';
    $('#kopier').hidden=!skriv;$('#vis-faste').hidden=false;
    // latest change
    const s=D.endringer[0];
    $('#lese-info').innerHTML=feilTekst?`<span class="feil">${esc(feilTekst)}</span>`:!nett?'Du er frakoblet. Du ser planen slik den var sist, og kan endre den når du er på nett igjen.':(s?`Sist endret: <b>${esc(navnFor(s.av))}</b> ${esc(s.tekst)} · ${esc(naar(s.tid))}`:(lastet?'Alle endringer lagres med en gang og vises for alle.':'Laster planen …'));
    // days
    const vis=[0,1,2,3,4,...[5,6].filter(i=>oppgaverFor(i).length)];
    if(!vis.includes(valgtDag))valgtDag=0;
    $('#tavle').style.setProperty('--dager',vis.length);
    const idagIdx=ukeId(mandagFor(idag))===id?(idag.getDay()+6)%7:-1;
    $('#dagfaner').innerHTML=vis.map(i=>{const d=datoFor(i),ant=oppgaverFor(i).filter(o=>!o.ferdig).length;return `<button type="button" role="tab" data-dag="${i}" aria-selected="${i===valgtDag}" class="${i===idagIdx?'idag':''}"><b>${KORT[i]}</b><span>${d.getDate()}.</span>${ant?`<i>${ant}</i>`:''}</button>`}).join('');
    const ae=document.activeElement, skriver=ae&&ae.matches&&ae.matches('.hurtig input')?{dag:ae.closest('form').dataset.hurtig,v:ae.value,a:ae.selectionStart,b:ae.selectionEnd}:null;
    const venter=!lastet&&!D.oppgaver.length&&!D.faste.length;
    $('#tavle').innerHTML=vis.map(i=>{
      const d=datoFor(i),liste=oppgaverFor(i);
      return `<section class="dag${i===idagIdx?' idag':''}${i===valgtDag?' valgt':''}" aria-labelledby="dag-${i}">
        <div class="dag-hode"><h2 id="dag-${i}">${DAGER[i]}${i===idagIdx?'<span class="idag-pill">I dag</span>':''}</h2><span>${d.getDate()}. ${MND[d.getMonth()]}</span></div>
        <ul class="liste">${venter?'<li class="tom-dag">Laster …</li>':liste.length?liste.map(o=>{const at=attrTekst(o);const harTopp=o.tid||(o.type&&o.type!=='annet');return `<li class="oppg${o.ferdig?' ferdig':''}${skriv?' klikkbar':''}" style="--type:${TYPEFARGE[o.type]||TYPEFARGE.annet}" data-id="${esc(o.id)}" data-dag="${i}" data-fast="${o.fast}" ${skriv?'tabindex="0" role="button" aria-label="Endre oppgave: '+esc(o.tittel)+'"':''}>
            ${harTopp?`<div class="oppg-topp"><span class="tid">${esc(o.tid||'')}</span>${o.type&&o.type!=='annet'?`<span class="type">${TYPER[o.type]||''}</span>`:''}</div>`:''}
            <h3>${esc(o.tittel)}</h3>
            ${o.notat?`<p class="notattekst">${esc(o.notat)}</p>`:''}
            <div class="oppg-bunn">${o.ansvarlig?`<span class="person">${esc(o.ansvarlig)}</span>`:''}${o.fast?'<span class="fast">↻ Fast</span>':''}
              ${skriv?`<button class="sjekk" type="button" role="checkbox" aria-checked="${!!o.ferdig}" data-sjekk aria-label="Merk som ferdig: ${esc(o.tittel)}" style="margin-left:auto">${o.ferdig?ikonHake:''}</button>`:(o.ferdig?'<span class="hake" style="margin-left:auto">'+ikonHake.replace('<svg','<svg width="14" height="14"')+' Ferdig</span>':'')}</div>
            ${at?`<p class="av">${esc(at)}</p>`:''}
          </li>`}).join(''):`<li class="tom-dag">${person?'Ingen oppgaver for '+esc(person)+'.':'Ingen oppgaver.'}</li>`}</ul>
        ${skriv?`<form class="hurtig" data-hurtig="${i}" autocomplete="off"><label class="sr" for="hurtig-${i}">Ny oppgave ${DAGER[i].toLowerCase()}</label><input id="hurtig-${i}" placeholder="+ Ny oppgave" maxlength="120" enterkeyhint="done"><button type="submit" class="knapp primar">Legg til</button></form>`:''}
      </section>`}).join('');
    if(skriver){const f=$(`.hurtig[data-hurtig="${skriver.dag}"] input`);if(f){f.value=skriver.v;f.focus({preventScroll:true});try{f.setSelectionRange(skriver.a,skriver.b)}catch(e){}}}
    if($('#logg-dlg').open)tegnLogg();
    if($('#ansatt-dlg').open&&!$('#ansatt-dlg').contains(document.activeElement)||($('#ansatt-dlg').open&&document.activeElement===document.body))tegnAnsatte();
  }

  // install hint (iPhone/iPad in Safari, not yet on the home screen) and Android install button
  let installHendelse=null;
  addEventListener('beforeinstallprompt',e=>{e.preventDefault();installHendelse=e;render()});
  const erIOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const frittstaaende=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  function tegnBannere(){
    let h='';
    if(!frittstaaende()&&!lsHent('ukeplan-skjul-install')){
      if(erIOS)h+=`<div class="banner install"><span><b>Legg Ukeplan på hjemskjermen:</b> trykk <svg class="del-ikon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1.5v9M5 4.5l3-3 3 3M3.5 7.5v6h9v-6"/></svg> <b>Del</b> nederst i Safari og velg <b>«Legg til på Hjem-skjerm»</b>.</span><button class="lukk" type="button" data-skjul-install aria-label="Skjul">×</button></div>`;
      else if(installHendelse)h+=`<div class="banner install"><span><b>Installer Ukeplan</b> som app på denne enheten.</span><span><button class="knapp primar" type="button" data-installer>Installer</button> <button class="lukk" type="button" data-skjul-install aria-label="Skjul">×</button></span></div>`;
    }
    $('#bannere').innerHTML=h;
  }
  $('#bannere').addEventListener('click',async e=>{
    if(e.target.closest('[data-skjul-install]')){lsSett('ukeplan-skjul-install','1');render()}
    if(e.target.closest('[data-installer]')&&installHendelse){installHendelse.prompt();try{await installHendelse.userChoice}catch(_){}installHendelse=null;render()}
  });

  // ---------- events on the board ----------
  $('#forrige').addEventListener('click',()=>{mandag=new Date(mandag);mandag.setDate(mandag.getDate()-7);redigererNotat=false;render()});
  $('#neste').addEventListener('click',()=>{mandag=new Date(mandag);mandag.setDate(mandag.getDate()+7);redigererNotat=false;render()});
  $('#idag-knapp').addEventListener('click',()=>{idag=osloIdag();mandag=mandagFor(idag);valgtDag=Math.min((idag.getDay()+6)%7,4);redigererNotat=false;render()});
  $('#personer').addEventListener('click',e=>{const b=e.target.closest('[data-person]');if(!b)return;person=b.dataset.person;lsSett('ukeplan-person',person);render()});
  $('#dagfaner').addEventListener('click',e=>{const b=e.target.closest('[data-dag]');if(!b)return;valgtDag=+b.dataset.dag;render()});
  $('#tavle').addEventListener('click',e=>{
    const s=e.target.closest('[data-sjekk]');
    if(s){const li=s.closest('.oppg');veksleFerdig(li.dataset.id,+li.dataset.dag,li.dataset.fast==='true');return}
    const li=e.target.closest('.oppg.klikkbar');if(li)apneOppgave(li.dataset.id,+li.dataset.dag,li.dataset.fast==='true');
  });
  $('#tavle').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.oppg.klikkbar')){e.preventDefault();apneOppgave(e.target.dataset.id,+e.target.dataset.dag,e.target.dataset.fast==='true')}});
  $('#tavle').addEventListener('submit',e=>{
    const f=e.target.closest('.hurtig');if(!f)return;e.preventDefault();
    const inp=f.querySelector('input'),t=inp.value.trim();if(!t){inp.focus();return}
    const dag=+f.dataset.hurtig,uke=ukeId(mandag);inp.value='';
    const rad={uke,dag,tittel:t,ansvarlig:person||'',type:'annet',tid:'',notat:''};
    // show it straight away; the saved row replaces it a moment later
    const tmp={...rad,id:'tmp-'+Date.now(),ferdig:false,av:meEpost,opprettet:new Date().toISOString()};D.oppgaver.push(tmp);render();
    skriv(['oppgaver'],()=>sb.from('oppgaver').insert(rad),`la til «${t}» på ${DAGER[dag].toLowerCase()}`,()=>{D.oppgaver=D.oppgaver.filter(o=>o!==tmp)});
  });
  $('#notat').addEventListener('click',e=>{
    if(e.target.id==='notat-rediger'){
      const id=ukeId(mandag),u=ukeRad(id);redigererNotat=true;
      $('#notat').innerHTML=`<span class="etikett">Beskjed</span><label class="sr" for="notat-felt">Beskjed for uken</label><textarea id="notat-felt" maxlength="2000" placeholder="Skriv en beskjed til alle for denne uken">${esc(u.notat||'')}</textarea><div class="notat-knapper"><button class="knapp" type="button" id="notat-avbryt">Avbryt</button><button class="knapp mork" type="button" id="notat-ok">Lagre</button></div>`;
      $('#notat-felt').focus();
    }
    if(e.target.id==='notat-avbryt'){redigererNotat=false;render()}
    if(e.target.id==='notat-ok'){
      const id=ukeId(mandag),u=ukeRad(id),t=$('#notat-felt').value.trim();redigererNotat=false;
      if(t!==(u.notat||''))skriv(['uker'],()=>sb.from('uker').upsert({uke:id,notat:t},{onConflict:'uke'}),t?`endret beskjeden for uke ${ukeNr(id)}`:`fjernet beskjeden for uke ${ukeNr(id)}`);
      render();
    }
  });

  // ---------- saving ----------
  let statusTimer=0, rydda=false;
  function status(t,type){const s=$('#status');s.textContent=t;s.className='status vis'+(type?' '+type:'');clearTimeout(statusTimer);if(type!=='lagrer')statusTimer=setTimeout(()=>s.className='status',type==='feil'?6000:1800)}
  async function skriv(tabeller,arbeid,tekst,angre){
    if(!kanSkrive()){status(nett?'Du kan ikke endre planen akkurat nå.':'Du er frakoblet – prøv igjen når du er på nett.','feil');if(angre){angre();render()}return false}
    status('Lagrer …','lagrer');
    try{
      const res=await arbeid();
      const feil=[].concat(res||[]).map(r=>r&&r.error).find(Boolean);if(feil)throw feil;
      if(tekst){await sb.from('endringer').insert({tekst:String(tekst).slice(0,300),uke:ukeId(mandag)})}
      await hent([...tabeller,'endringer']);
      status('Lagret – alle ser endringen');
      if(!rydda){rydda=true;ryddGammelt()}
      return true;
    }catch(e){
      if(angre)angre();
      const m=(e&&(e.message||e.msg))||'';
      if(e&&(e.code==='42501'||/row-level security/i.test(m)))status('Du har ikke tilgang til å gjøre dette.','feil');
      else if(/minst én administrator/i.test(m))status('Det må være minst én administrator.','feil');
      else if(e&&e.code==='23505')status('Denne e-posten står allerede på listen.','feil');
      else if(/fetch|network|Failed/i.test(m))status('Kunne ikke lagre – sjekk nettet og prøv igjen.','feil');
      else status('Kunne ikke lagre. Prøv igjen.','feil');
      await hent(tabeller).catch(()=>{});render();
      return false;
    }
  }
  async function ryddGammelt(){
    // keep the database small: tasks and weeks older than 16 weeks, history older than 60 days
    try{
      const g=grenseUke();
      await sb.from('oppgaver').delete().lt('uke',g);
      await sb.from('uker').delete().lt('uke',g);
      await sb.from('ferdig_faste').delete().lt('uke',g);
      await sb.from('hopp_over').delete().lt('uke',g);
      await sb.from('endringer').delete().lt('tid',new Date(Date.now()-60*864e5).toISOString());
      const gamle=D.foresporsler.filter(f=>f.status==='ferdig'&&new Date(f.mottatt)<new Date(Date.now()-365*864e5)).slice(0,50);
      if(gamle.length){const bilder=gamle.flatMap(f=>f.bilder||[]);if(bilder.length&&sb.storage)await sb.storage.from('foresporsel-bilder').remove(bilder);await sb.from('foresporsler').delete().in('id',gamle.map(f=>f.id))}
    }catch(e){}
  }

  function veksleFerdig(id,dag,fast){
    const uke=ukeId(mandag);
    if(fast){
      const f=D.faste.find(x=>x.id===id);if(!f)return;
      const fra=D.ferdig_faste.find(x=>x.uke===uke&&x.fast_id===id&&x.dag===dag);
      if(fra){D.ferdig_faste=D.ferdig_faste.filter(x=>x!==fra);render();skriv(['ferdig_faste'],()=>sb.from('ferdig_faste').delete().match({uke,fast_id:id,dag}),`angret «ferdig» på «${f.tittel}» (${DAGER[dag].toLowerCase()})`,()=>D.ferdig_faste.push(fra))}
      else{const ny={uke,fast_id:id,dag,av:meEpost,tid:new Date().toISOString()};D.ferdig_faste.push(ny);render();skriv(['ferdig_faste'],()=>sb.from('ferdig_faste').insert({uke,fast_id:id,dag}),`merket «${f.tittel}» som ferdig (${DAGER[dag].toLowerCase()})`,()=>{D.ferdig_faste=D.ferdig_faste.filter(x=>x!==ny)})}
    }else{
      const o=D.oppgaver.find(x=>x.id===id);if(!o||String(id).startsWith('tmp-'))return;
      const for_={ferdig:o.ferdig,ferdig_av:o.ferdig_av,ferdig_tid:o.ferdig_tid};
      Object.assign(o,{ferdig:!o.ferdig,ferdig_av:!o.ferdig?meEpost:null,ferdig_tid:!o.ferdig?new Date().toISOString():null});render();
      skriv(['oppgaver'],()=>sb.from('oppgaver').update({ferdig:o.ferdig}).eq('id',id),o.ferdig?`merket «${o.tittel}» som ferdig`:`angret «ferdig» på «${o.tittel}»`,()=>Object.assign(o,for_));
    }
  }

  // ---------- task window ----------
  const oDlg=$('#oppg-dlg'), oSkj=$('#oppg-skjema');
  function apneOppgave(id,dag,fast,forslag){
    if(!kanSkrive()||String(id).startsWith('tmp-'))return;
    const uke=ukeId(mandag);
    const o=id?(fast?D.faste.find(f=>f.id===id):D.oppgaver.find(x=>x.id===id)):null;
    const ny=!o;
    const v=o||{tittel:'',dag,tid:'',notat:'',ansvarlig:person||'',type:'annet',...(forslag||{})};
    const fastDag=fast?o.dag:dag;
    const hist=o?[o.av&&o.av!=='system'?`Lagt til av ${navnFor(o.av)}${o.opprettet?' · '+naar(o.opprettet):''}`:'',attrTekst(o).startsWith('Endret')?`Sist endret av ${navnFor(o.endret_av)} · ${naar(o.endret)}`:''].filter(Boolean):[];
    const folk=[...new Set([...D.ansatte.map(a=>a.navn),...(v.ansvarlig?[v.ansvarlig]:[])])];
    oSkj.innerHTML=`<h2 id="oppg-tittel">${ny?'Ny oppgave':'Endre oppgave'}</h2>
      ${hist.length?`<p class="hint">${hist.map(esc).join('<br>')}</p>`:''}
      <div class="felt"><label for="o-tittel">Hva skal gjøres?</label><input id="o-tittel" value="${esc(v.tittel)}" placeholder="F.eks. Service på ATV" autocomplete="off" maxlength="120"><span class="feil" id="o-feil" hidden>Skriv hva som skal gjøres.</span></div>
      <div class="rad">
        <div class="felt"><label for="o-dag">Dag</label><select id="o-dag">${(fast||ny)?`<option value="-1" ${fastDag===-1?'selected':''}>Hver ukedag (man–fre)</option>`:''}${DAGER.map((d,i)=>`<option value="${i}" ${i===fastDag?'selected':''}>${d}</option>`).join('')}</select></div>
        <div class="felt"><label for="o-ansvarlig">Hvem</label><select id="o-ansvarlig"><option value="">Alle / ikke fordelt</option>${folk.map(p=>`<option ${p===v.ansvarlig?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      </div>
      <details class="flere" ${v.tid||v.notat||fast?'open':''}><summary>Tid, notat og mer</summary><div class="flere-innhold">
        <div class="rad">
          <div class="felt"><label for="o-tid">Tid</label><input id="o-tid" type="time" value="${esc(v.tid)}"></div>
          <div class="felt"><label for="o-type">Type</label><select id="o-type">${Object.entries(TYPER).map(([k,t])=>`<option value="${k}" ${k===v.type?'selected':''}>${t}</option>`).join('')}</select></div>
        </div>
        <div class="felt"><label for="o-notat">Notat</label><textarea id="o-notat" placeholder="Detaljer, kundenavn, deler som trengs …" maxlength="1000">${esc(v.notat)}</textarea></div>
        ${fast?`<p class="hint">↻ Fast oppgave – endringen gjelder alle uker.</p>`:`<label class="avkrys"><input type="checkbox" id="o-fast"> Gjenta hver uke</label>`}
      </div></details>
      <div class="dlg-knapper"><div>${ny?'':`<button class="knapp fare" type="button" id="o-slett">${fast?'Slett fast oppgave':'Slett'}</button>${fast?'<button class="knapp" type="button" id="o-hopp">Hopp over denne dagen</button>':''}`}</div><div><button class="knapp" type="button" id="o-avbryt">Avbryt</button><button class="knapp primar" type="submit">${ny?'Legg til':'Lagre'}</button></div></div>`;
    $('#o-avbryt').onclick=()=>oDlg.close();
    const sl=$('#o-slett');if(sl)sl.onclick=()=>{if(sl.dataset.bekreft){oDlg.close();skriv([fast?'faste':'oppgaver'],()=>sb.from(fast?'faste':'oppgaver').delete().eq('id',id),fast?`slettet den faste oppgaven «${o.tittel}»`:`slettet «${o.tittel}»`)}else{sl.dataset.bekreft='1';sl.textContent='Trykk igjen for å slette'}};
    const hp=$('#o-hopp');if(hp)hp.onclick=()=>{oDlg.close();skriv(['hopp_over'],()=>sb.from('hopp_over').insert({uke,fast_id:id,dag}),`hoppet over «${o.tittel}» på ${DAGER[dag].toLowerCase()}`)};
    oSkj.onsubmit=e=>{
      e.preventDefault();
      const t=$('#o-tittel').value.trim();if(!t){$('#o-feil').hidden=false;$('#o-tittel').focus();return}
      const data={tittel:t,dag:+$('#o-dag').value,tid:$('#o-tid').value||'',ansvarlig:$('#o-ansvarlig').value,type:$('#o-type').value,notat:$('#o-notat').value.trim()};
      const dagTekst=data.dag===-1?'hver ukedag':DAGER[data.dag].toLowerCase();
      const gjenta=!fast&&$('#o-fast')&&$('#o-fast').checked;
      oDlg.close();
      if(ny){
        if(gjenta||data.dag===-1)skriv(['faste'],()=>sb.from('faste').insert(data),`la til den faste oppgaven «${t}» (${dagTekst})`);
        else skriv(['oppgaver'],()=>sb.from('oppgaver').insert({...data,uke}),`la til «${t}» på ${dagTekst}`);
      }else if(gjenta){
        skriv(['faste','oppgaver'],async()=>{const r=await sb.from('faste').insert(data);if(r.error)return r;return sb.from('oppgaver').delete().eq('id',id)},`gjorde «${t}» til en fast oppgave (${dagTekst})`);
      }else{
        if(!Object.keys(data).some(k=>String(data[k])!==String(o[k]??'')))return;
        skriv([fast?'faste':'oppgaver'],()=>sb.from(fast?'faste':'oppgaver').update(data).eq('id',id),`endret «${t}»${data.dag!==o.dag?' (flyttet til '+dagTekst+')':''}`);
      }
    };
    oDlg.showModal();oDlg.scrollTop=0;if(ny)setTimeout(()=>$('#o-tittel').focus(),40);
  }

  // ---------- "Mer" menu ----------
  const mer=$('#mer');
  mer.addEventListener('click',e=>{if(e.target.closest('.mer-meny button'))mer.open=false});
  document.addEventListener('click',e=>{if(mer.open&&!mer.contains(e.target))mer.open=false});

  // ---------- staff (admins add people and their login emails) ----------
  const aDlg=$('#ansatt-dlg');
  function tegnAnsatte(){
    const adm=erAdmin()&&kanSkrive();
    $('#ansatt-innhold').innerHTML=`<h2 id="ansatt-tittel">Ansatte</h2>
      <p class="hint">${adm?'Alle med e-post på listen kan logge inn og endre planen. Navnene brukes til å fordele oppgaver.':'Bare en administrator kan endre listen.'}</p>
      <ul class="ansattliste">${D.ansatte.length?D.ansatte.map(a=>`<li><span class="ans-info"><span>${esc(a.navn)}${a.admin?'<span class="merke-admin">Admin</span>':''}</span><small>${a.email?esc(a.email):'Ingen innlogging'}</small></span>${adm?`<span class="ans-knapper"><button type="button" data-admin="${esc(a.id)}">${a.admin?'Fjern admin':'Gjør til admin'}</button>${a.email!==meEpost?`<button type="button" class="fjern" data-fjern="${esc(a.id)}">Fjern</button>`:''}</span>`:''}</li>`).join(''):'<li><span class="hint">Ingen ansatte lagt inn ennå.</span></li>'}</ul>
      ${adm?`<form class="ny-ansatt" id="ansatt-ny" novalidate>
        <div class="rad"><div class="felt"><label for="a-navn">Navn</label><input id="a-navn" autocomplete="off" maxlength="60"></div>
        <div class="felt"><label for="a-epost">E-post <span class="hint">(for innlogging)</span></label><input id="a-epost" type="email" inputmode="email" autocapitalize="off" spellcheck="false" autocomplete="off"></div></div>
        <label class="avkrys"><input type="checkbox" id="a-admin"> Administrator (kan endre ansattlisten)</label>
        <span class="feil" id="a-feil" hidden></span>
        <button class="knapp mork" type="submit">Legg til</button></form>`:''}
      <div class="dlg-knapper"><span></span><button class="knapp primar" type="button" id="a-ferdig">Ferdig</button></div>`;
    $('#a-ferdig').onclick=()=>aDlg.close();
    const f=$('#ansatt-ny');if(f)f.onsubmit=e=>{
      e.preventDefault();const navn=$('#a-navn').value.trim(),epost=$('#a-epost').value.trim().toLowerCase(),admin=$('#a-admin').checked;
      const fe=$('#a-feil');fe.hidden=true;
      if(!navn){fe.textContent='Skriv navnet.';fe.hidden=false;return}
      if(epost&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)){fe.textContent='E-posten ser ikke riktig ut.';fe.hidden=false;return}
      if(epost&&D.ansatte.some(a=>a.email===epost)){fe.textContent='Denne e-posten står allerede på listen.';fe.hidden=false;return}
      skriv(['ansatte'],()=>sb.from('ansatte').insert({navn,email:epost||null,admin}),`la til ${navn} som ansatt`).then(()=>{tegnAnsatte();const n=$('#a-navn');if(n)n.focus()});
    };
    $$('#ansatt-innhold [data-fjern]').forEach(b=>b.onclick=()=>{const a=D.ansatte.find(x=>x.id===b.dataset.fjern);if(!a)return;if(!b.dataset.bekreft){b.dataset.bekreft='1';b.textContent='Bekreft';return}skriv(['ansatte'],()=>sb.from('ansatte').delete().eq('id',a.id),`fjernet ${a.navn} fra ansattlisten`).then(tegnAnsatte)});
    $$('#ansatt-innhold [data-admin]').forEach(b=>b.onclick=()=>{const a=D.ansatte.find(x=>x.id===b.dataset.admin);if(!a)return;skriv(['ansatte'],()=>sb.from('ansatte').update({admin:!a.admin}).eq('id',a.id),a.admin?`fjernet admin for ${a.navn}`:`gjorde ${a.navn} til administrator`).then(()=>{oppdaterMeg();tegnAnsatte()})});
  }
  $('#vis-ansatte').addEventListener('click',()=>{tegnAnsatte();aDlg.showModal()});

  // ---------- recurring tasks ----------
  const fDlg=$('#faste-dlg');
  function tegnFaste(){
    const l=[...D.faste].sort((a,b)=>(a.dag===-1?-1:a.dag)-(b.dag===-1?-1:b.dag)||(a.tid||'').localeCompare(b.tid||''));
    const s=kanSkrive();
    $('#faste-innhold').innerHTML=`<h2 id="faste-tittel">Faste oppgaver</h2><p class="hint">Oppgaver som gjentas hver uke. Trykk på en oppgave i planen for å endre den, eller kryss av for «Gjenta hver uke».</p>
      <ul class="fastliste">${l.length?l.map(f=>`<li><span class="tid">${esc(f.tid||'–')}</span><span><b>${esc(f.tittel)}</b><br><small>${f.dag===-1?'Hver ukedag':DAGER[f.dag]}${f.ansvarlig?' · '+esc(f.ansvarlig):''}${f.av&&f.av!=='system'?' · lagt til av '+esc(navnFor(f.av)):''}</small></span>${s?`<button class="knapp fare" type="button" data-slett-fast="${esc(f.id)}">Slett</button>`:'<span></span>'}</li>`).join(''):'<li><span></span><span class="hint">Ingen faste oppgaver.</span><span></span></li>'}</ul>
      <div class="dlg-knapper"><span></span><button class="knapp primar" type="button" id="f-ferdig">Ferdig</button></div>`;
    $('#f-ferdig').onclick=()=>fDlg.close();
    $$('[data-slett-fast]').forEach(b=>b.onclick=()=>{if(!b.dataset.bekreft){b.dataset.bekreft='1';b.textContent='Bekreft';return}const f=D.faste.find(x=>x.id===b.dataset.slettFast);if(!f)return;skriv(['faste','ferdig_faste','hopp_over'],()=>sb.from('faste').delete().eq('id',f.id),`slettet den faste oppgaven «${f.tittel}»`).then(tegnFaste)});
  }
  $('#vis-faste').addEventListener('click',()=>{tegnFaste();fDlg.showModal()});

  // ---------- history ----------
  const lDlg=$('#logg-dlg');
  function tegnLogg(){
    $('#logg-innhold').innerHTML=`<h2 id="logg-tittel">Siste endringer</h2>
      <ul class="loggliste">${D.endringer.length?D.endringer.map(e=>`<li><span><b>${esc(navnFor(e.av))}</b> ${esc(e.tekst)}</span><small>${esc(naar(e.tid))}</small></li>`).join(''):'<li class="hint">Ingen endringer ennå.</li>'}</ul>
      <div class="dlg-knapper"><span class="hint">De siste ${D.endringer.length} endringene.</span><button class="knapp primar" type="button" id="l-ferdig">Lukk</button></div>`;
    $('#l-ferdig').onclick=()=>lDlg.close();
  }
  $('#vis-logg').addEventListener('click',()=>{tegnLogg();lDlg.showModal()});

  // ---------- copy last week ----------
  $('#kopier').addEventListener('click',()=>{
    const forrige=new Date(mandag);forrige.setDate(forrige.getDate()-7);
    const fra=ukeId(forrige),til=ukeId(mandag),rader=D.oppgaver.filter(o=>o.uke===fra);
    if(!rader.length){status('Forrige uke har ingen oppgaver å kopiere.','feil');return}
    skriv(['oppgaver'],()=>sb.from('oppgaver').insert(rader.map(o=>({uke:til,dag:o.dag,tid:o.tid||'',tittel:o.tittel,notat:o.notat||'',ansvarlig:o.ansvarlig||'',type:o.type||'annet'}))),`kopierte ${rader.length} oppgaver fra uke ${ukeNr(fra)} til uke ${ukeNr(til)}`);
  });

  // ---------- account ----------
  const kDlg=$('#konto-dlg');
  $('#meg').addEventListener('click',()=>{
    $('#konto-innhold').innerHTML=`<h2 id="konto-tittel">${esc(meg?meg.navn:'Konto')}</h2><p class="hint">Logget inn som ${esc(meEpost||'')}${erAdmin()?' · administrator':''}</p>
      <form id="nytt-passord" class="felt" novalidate><label for="k-passord">Nytt passord <span class="hint">(valgfritt)</span></label><input id="k-passord" type="password" autocomplete="new-password" minlength="8"><span class="feil" id="k-feil" hidden></span><button class="knapp" type="submit" style="justify-self:start;margin-top:6px">Bytt passord</button></form>
      <div class="dlg-knapper"><button class="knapp fare" type="button" id="k-ut">Logg ut</button><button class="knapp primar" type="button" id="k-lukk">Lukk</button></div>`;
    $('#k-lukk').onclick=()=>kDlg.close();
    $('#k-ut').onclick=async()=>{kDlg.close();await loggUt()};
    $('#nytt-passord').onsubmit=async e=>{e.preventDefault();const p=$('#k-passord').value,fe=$('#k-feil');fe.hidden=true;if(p.length<8){fe.textContent='Passordet må ha minst 8 tegn.';fe.hidden=false;return}
      const {error}=await sb.auth.updateUser({password:p});if(error){fe.textContent=norskAuthFeil(error);fe.hidden=false;return}kDlg.close();status('Passordet er byttet')};
    kDlg.showModal();
  });

  // =====================================================================
  //  SECTIONS (Plan · Timer · Forespørsler)
  // =====================================================================
  const SEKSJONER=['plan','timer','fors'];
  let seksjon=(()=>{const q=new URLSearchParams(location.search).get('s');return SEKSJONER.includes(q)?q:(SEKSJONER.includes(lsHent('ukeplan-seksjon'))?lsHent('ukeplan-seksjon'):'plan')})();
  function velgSeksjon(n){seksjon=n;lsSett('ukeplan-seksjon',n);window.scrollTo(0,0);render()}
  $('#appnav').addEventListener('click',e=>{const b=e.target.closest('[data-seksjon]');if(b)velgSeksjon(b.dataset.seksjon)});
  function tegnSeksjoner(){
    SEKSJONER.forEach(n=>{$('#s-'+n).hidden=n!==seksjon});
    $$('#appnav [data-seksjon]').forEach(b=>{if(b.dataset.seksjon===seksjon)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
    $('.ukenav').hidden=seksjon!=='plan';
    const nye=D.foresporsler.filter(f=>f.status==='ny').length;const a=$('#fors-ant');a.hidden=!nye;a.textContent=nye;
    tegnKlokkePill();
    if(seksjon==='timer')tegnTimer();
    if(seksjon==='fors')tegnFors();
  }

  // =====================================================================
  //  TIMER – clock in / out and hours
  // =====================================================================
  const minIso=d=>new Date(d).toISOString();
  const apenVakt=(e=meEpost)=>D.timer.find(t=>t.email===e&&!t.ut);
  const varighet=t=>Math.max(0,(t.ut?new Date(t.ut):new Date())-new Date(t.inn));
  function tt(ms){const m=Math.round(ms/60000),h=Math.floor(m/60),r=m%60;return h?`${h} t${r?' '+r+' min':''}`:`${r} min`}
  const kl=d=>{try{return new Date(d).toLocaleTimeString('nb-NO',{hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
  const dagNokkel=d=>{const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`};
  const MANEDER=['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
  let timerMnd=(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1)})();
  let timerPerson=null; // admin: null = me, '*' = everyone, or an email

  function tegnKlokkePill(){
    const p=$('#klokke-pill');if(!meg){p.hidden=true;return}
    const a=apenVakt();p.hidden=false;p.classList.toggle('inne',!!a);
    p.innerHTML=a?`<i></i>Inne · ${tt(varighet(a))}`:'Stemple inn';
    p.title=a?'Du er stemplet inn – trykk for å se timene dine':'Stemple inn';
  }
  $('#klokke-pill').addEventListener('click',()=>{if(apenVakt())velgSeksjon('timer');else stempleInn()});
  setInterval(()=>{if(meg&&apenVakt()){tegnKlokkePill();if(seksjon==='timer')oppdaterLopende()}},30000);

  function stempleInn(){
    if(apenVakt())return;
    const tmp={id:'tmp-'+Date.now(),email:meEpost,inn:minIso(Date.now()),ut:null,korrigert:false};D.timer.unshift(tmp);render();
    skriv(['timer'],()=>sb.from('timer').insert({}),null,()=>{D.timer=D.timer.filter(t=>t!==tmp)}).then(ok=>{if(ok)status('Stemplet inn kl. '+kl(Date.now()))});
  }
  function stempleUt(){
    const a=apenVakt();if(!a||String(a.id).startsWith('tmp-'))return;
    const for_=a.ut;a.ut=minIso(Date.now());render();
    skriv(['timer'],()=>sb.from('timer').update({ut:a.ut}).eq('id',a.id),null,()=>{a.ut=for_}).then(ok=>{if(ok)status(`Stemplet ut – ${tt(varighet(a))} i dag`)});
  }

  function vakterFor(epost,fra,til){return D.timer.filter(t=>(epost==='*'||t.email===epost)&&new Date(t.inn)>=fra&&new Date(t.inn)<til)}
  function oppdaterLopende(){$$('[data-lopende]').forEach(el=>{const t=D.timer.find(x=>x.id===el.dataset.lopende);if(t)el.textContent=tt(varighet(t))})}

  function tegnTimer(){
    const s=$('#s-timer');if(!meg){s.innerHTML='';return}
    const adm=erAdmin(), hvem=adm?(timerPerson||meEpost):meEpost;
    const a=apenVakt();
    const fra=new Date(timerMnd), til=new Date(fra.getFullYear(),fra.getMonth()+1,1);
    const ukeStart=mandagFor(new Date()), ukeSlutt=new Date(ukeStart);ukeSlutt.setDate(ukeSlutt.getDate()+7);
    const sum=l=>l.reduce((x,t)=>x+varighet(t),0);
    const valg=adm?`<label class="timer-hvem"><span class="sr">Vis timer for</span><select id="timer-person"><option value="${esc(meEpost)}" ${hvem===meEpost?'selected':''}>Mine timer</option><option value="*" ${hvem==='*'?'selected':''}>Alle ansatte</option>${D.ansatte.filter(x=>x.email&&x.email!==meEpost).map(x=>`<option value="${esc(x.email)}" ${hvem===x.email?'selected':''}>${esc(x.navn)}</option>`).join('')}</select></label>`:'';
    const mndNav=`<div class="mnd-nav"><button type="button" data-mnd="-1" aria-label="Forrige måned">‹</button><b>${MANEDER[fra.getMonth()]} ${fra.getFullYear()}</b><button type="button" data-mnd="1" aria-label="Neste måned">›</button></div>`;
    let innhold='';
    if(hvem==='*'){
      const rader=D.ansatte.filter(x=>x.email).map(x=>{const l=vakterFor(x.email,fra,til);return {x,l,dager:new Set(l.map(t=>dagNokkel(t.inn))).size,ms:sum(l),inne:apenVakt(x.email)}});
      innhold=`<div class="tabellboks"><table class="timetabell"><thead><tr><th>Navn</th><th>Dager</th><th>Timer</th><th></th></tr></thead><tbody>${rader.map(r=>`<tr><td><button type="button" class="lenke" data-vis-person="${esc(r.x.email)}">${esc(r.x.navn)}</button></td><td>${r.dager}</td><td><b>${tt(r.ms)}</b>${r.l.some(t=>t.korrigert)?' <span class="korr" title="Noen tider er lagt inn eller endret for hånd">endret</span>':''}</td><td>${r.inne?`<span class="inne-merke">Inne siden ${kl(r.inne.inn)}</span>`:''}</td></tr>`).join('')}</tbody><tfoot><tr><td>Totalt</td><td></td><td><b>${tt(rader.reduce((x,r)=>x+r.ms,0))}</b></td><td></td></tr></tfoot></table></div>`;
    }else{
      const l=vakterFor(hvem,fra,til);
      const perDag={};l.forEach(t=>{(perDag[dagNokkel(t.inn)]=perDag[dagNokkel(t.inn)]||[]).push(t)});
      const dager=Object.keys(perDag).sort().reverse();
      const ukeMs=sum(vakterFor(hvem,ukeStart,ukeSlutt));
      const navnH=hvem===meEpost?'':`<h2 class="timer-navn">${esc(navnFor(hvem))}</h2>`;
      innhold=`${navnH}<div class="sumkort"><div><small>Denne uken</small><b>${tt(ukeMs)}</b></div><div><small>${MANEDER[fra.getMonth()].replace(/^./,c=>c.toUpperCase())}</small><b>${tt(sum(l))}</b></div><div><small>Dager jobbet</small><b>${dager.length}</b></div></div>
        <ul class="dagliste">${dager.length?dager.map(k=>{const v=perDag[k].sort((x,y)=>new Date(x.inn)-new Date(y.inn));const d=new Date(v[0].inn);return `<li><div class="dl-dato"><b>${DAGER[(d.getDay()+6)%7]}</b><span>${d.getDate()}. ${MND[d.getMonth()]}</span></div>
          <div class="dl-vakter">${v.map(t=>`<button type="button" class="vakt" data-vakt="${esc(t.id)}"><span>${kl(t.inn)} – ${t.ut?kl(t.ut):'<em>nå</em>'}</span>${t.korrigert?'<span class="korr" title="Lagt inn eller endret for hånd">endret</span>':''}</button>`).join('')}</div>
          <b class="dl-sum" ${v.some(t=>!t.ut)?`data-lopende="${esc(v.find(t=>!t.ut).id)}"`:''}>${tt(sum(v))}</b></li>`}).join(''):`<li class="tom-dag">Ingen timer registrert i ${MANEDER[fra.getMonth()]}.</li>`}</ul>`;
    }
    s.innerHTML=`<section class="klokke-kort${a?' inne':''}">
        <div><small>${a?'Du er stemplet inn':'Du er ikke stemplet inn'}</small><b>${a?`Siden kl. ${kl(a.inn)} · <span data-lopende="${esc(a.id)}">${tt(varighet(a))}</span>`:esc(meg.navn)}</b></div>
        <button class="knapp ${a?'mork':'primar'} stor" type="button" id="stemple" ${kanSkrive()?'':'disabled'}>${a?'Stemple ut':'Stemple inn'}</button>
      </section>
      <div class="timer-topp">${valg}${mndNav}</div>
      ${innhold}
      ${hvem!=='*'&&kanSkrive()?`<button class="knapp" type="button" id="ny-vakt">+ Legg til timer manuelt</button>`:''}
      <p class="hint timer-info">Timer du legger inn eller endrer for hånd blir merket «endret», så sjefen ser det.</p>`;
    $('#stemple').onclick=()=>apenVakt()?stempleUt():stempleInn();
    $$('#s-timer [data-mnd]').forEach(b=>b.onclick=()=>{timerMnd=new Date(timerMnd.getFullYear(),timerMnd.getMonth()+(+b.dataset.mnd),1);tegnTimer()});
    const tp=$('#timer-person');if(tp)tp.onchange=()=>{timerPerson=tp.value;tegnTimer()};
    $$('#s-timer [data-vis-person]').forEach(b=>b.onclick=()=>{timerPerson=b.dataset.visPerson;tegnTimer()});
    $$('#s-timer [data-vakt]').forEach(b=>b.onclick=()=>apneVakt(b.dataset.vakt));
    const nv=$('#ny-vakt');if(nv)nv.onclick=()=>apneVakt(null,hvem);
  }

  // edit / add a shift by hand
  const tDlg=$('#timer-dlg'), tSkj=$('#timer-skjema');
  const tilLokal=d=>{const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,16)};
  function apneVakt(id,epost){
    if(!kanSkrive())return;
    const t=id?D.timer.find(x=>x.id===id):null;if(id&&(!t||String(id).startsWith('tmp-')))return;
    const startInn=t?t.inn:(()=>{const d=new Date();d.setHours(8,0,0,0);return d})();
    const startUt=t?t.ut:(()=>{const d=new Date();d.setHours(16,0,0,0);return d})();
    const hvem=t?t.email:(epost||meEpost);
    tSkj.innerHTML=`<h2 id="timer-tittel">${t?'Endre timer':'Legg til timer'}</h2>
      ${hvem!==meEpost?`<p class="hint">For ${esc(navnFor(hvem))}</p>`:''}
      ${t&&t.endret_av?`<p class="hint">Sist endret av ${esc(navnFor(t.endret_av))} · ${esc(naar(t.endret))}</p>`:''}
      <div class="felt"><label for="v-inn">Inn</label><input id="v-inn" type="datetime-local" value="${tilLokal(startInn)}"></div>
      <div class="felt"><label for="v-ut">Ut ${t&&!t.ut?'<span class="hint">(tom = fortsatt inne)</span>':''}</label><input id="v-ut" type="datetime-local" value="${startUt?tilLokal(startUt):''}"></div>
      <span class="feil" id="v-feil" hidden></span>
      <div class="dlg-knapper"><div>${t?'<button class="knapp fare" type="button" id="v-slett">Slett</button>':''}</div><div><button class="knapp" type="button" id="v-avbryt">Avbryt</button><button class="knapp primar" type="submit">Lagre</button></div></div>`;
    $('#v-avbryt').onclick=()=>tDlg.close();
    const sl=$('#v-slett');if(sl)sl.onclick=()=>{if(!sl.dataset.bekreft){sl.dataset.bekreft='1';sl.textContent='Trykk igjen for å slette';return}tDlg.close();skriv(['timer'],()=>sb.from('timer').delete().eq('id',t.id),null)};
    tSkj.onsubmit=e=>{
      e.preventDefault();const fe=$('#v-feil');fe.hidden=true;
      const inn=$('#v-inn').value?new Date($('#v-inn').value):null, ut=$('#v-ut').value?new Date($('#v-ut').value):null;
      const feil=m=>{fe.textContent=m;fe.hidden=false};
      if(!inn||isNaN(inn))return feil('Velg når du kom.');
      if(!ut&&!(t&&!t.ut))return feil('Velg når du gikk.');
      if(ut&&ut<=inn)return feil('«Ut» må være etter «Inn».');
      if(ut&&ut-inn>=24*36e5)return feil('En vakt kan ikke være 24 timer eller mer.');
      if(inn>new Date(Date.now()+5*6e4))return feil('«Inn» kan ikke være fram i tid.');
      tDlg.close();
      const rad={inn:inn.toISOString(),ut:ut?ut.toISOString():null};
      if(t)skriv(['timer'],()=>sb.from('timer').update(rad).eq('id',t.id),null);
      else skriv(['timer'],()=>sb.from('timer').insert({...rad,email:hvem}),null);
    };
    tDlg.showModal();
  }

  // =====================================================================
  //  FORESPØRSLER – requests from the website
  // =====================================================================
  let forsFilter='aktive';
  const STATUS={ny:'Ny',under_arbeid:'Under arbeid',ferdig:'Ferdig'};
  const bildeUrl={};
  async function hentBilder(stier){
    const mangler=stier.filter(p=>!bildeUrl[p]);if(!mangler.length||!sb.storage)return;
    try{const {data}=await sb.storage.from('foresporsel-bilder').createSignedUrls(mangler,3600);(data||[]).forEach(d=>{if(d.signedUrl)bildeUrl[d.path]=d.signedUrl});if(seksjon==='fors')tegnFors()}catch(e){}
  }
  const kr=n=>'kr '+Number(n).toLocaleString('nb-NO');
  function tegnFors(){
    const s=$('#s-fors');
    const ant=k=>D.foresporsler.filter(f=>k==='aktive'?f.status!=='ferdig':k==='alle'?true:f.status===k).length;
    const liste=D.foresporsler.filter(f=>forsFilter==='aktive'?f.status!=='ferdig':forsFilter==='alle'?true:f.status===forsFilter);
    const skriv_=kanSkrive();
    hentBilder(liste.flatMap(f=>f.bilder||[]));
    const fokus=document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#s-fors .internt')?{id:document.activeElement.closest('.fors-kort').dataset.fors,v:document.activeElement.value}:null;
    s.innerHTML=`<div class="fors-topp"><h2>Forespørsler</h2><p class="hint">Fra nettsiden – produktforespørsler og servicebestillinger. Alle ansatte ser dem.</p></div>
      <div class="chips" role="group" aria-label="Filter">${[['aktive','Åpne'],['ny','Nye'],['under_arbeid','Under arbeid'],['ferdig','Ferdige'],['alle','Alle']].map(([k,t])=>`<button class="chip" type="button" data-fors-filter="${k}" aria-pressed="${forsFilter===k}">${t} <small>${ant(k)}</small></button>`).join('')}</div>
      <div class="fors-liste">${liste.length?liste.map(f=>{
        const prod=f.type==='produkt';
        const linjer=prod&&Array.isArray(f.produkter)?f.produkter.map(p=>`<li><b>${esc(p.antall||1)} ×</b> ${esc(p.navn||'')}${p.pris?` <small>${kr(p.pris)}</small>`:''}</li>`).join(''):'';
        return `<article class="fors-kort status-${esc(f.status)}" data-fors="${esc(f.id)}">
          <header><span class="fors-type ${prod?'produkt':'service'}">${prod?'Produkt':'Service'}</span>${f.nr?`<span class="fors-nr">${esc(f.nr)}</span>`:''}<span class="fors-tid">${esc(naar(f.mottatt))}</span><span class="fors-status">${STATUS[f.status]||''}</span></header>
          <h3>${esc(f.navn)}</h3>
          <p class="fors-kontakt"><a href="tel:${esc(String(f.telefon).replace(/\s/g,''))}">${esc(f.telefon)}</a>${f.epost?` · <a href="mailto:${esc(f.epost)}">${esc(f.epost)}</a>`:''}</p>
          ${prod?`<ul class="fors-linjer">${linjer}</ul><p class="fors-detalj">${f.levering==='hjem'?`Ønsker levering${f.adresse?': '+esc(f.adresse):''}`:'Henter i butikken'}${f.sum_kr?` · Veil. sum ${kr(f.sum_kr)}`:''}</p>`
                :`<p class="fors-detalj"><b>${esc(f.kategori||'Maskin')}</b>${f.merke||f.modell?' – '+esc([f.merke,f.modell].filter(Boolean).join(' ')):''}${f.onsket_dato?` · Ønsket dato: ${esc(new Date(f.onsket_dato+'T12:00').toLocaleDateString('nb-NO',{weekday:'short',day:'numeric',month:'short'}))}`:''}</p>`}
          ${f.melding?`<p class="fors-melding">${esc(f.melding)}</p>`:''}
          ${(f.bilder||[]).length?`<div class="fors-bilder">${f.bilder.map(p=>bildeUrl[p]?`<button type="button" data-bilde="${esc(p)}"><img src="${esc(bildeUrl[p])}" alt="Bilde fra kunden" loading="lazy"></button>`:'<span class="bilde-laster"></span>').join('')}</div>`:''}
          ${f.status_av?`<p class="av">${f.status==='ferdig'?'Ferdig':f.status==='under_arbeid'?'Tatt av':'Satt tilbake av'} ${esc(navnFor(f.status_av))} · ${esc(naar(f.status_tid))}</p>`:''}
          <details class="internt-boks" ${f.internt?'open':''}><summary>Internt notat${f.internt?'':' (bare for ansatte)'}</summary><textarea class="internt" maxlength="2000" placeholder="F.eks. «Ringt, venter på svar»" ${skriv_?'':'disabled'}>${esc(f.internt||'')}</textarea>${skriv_?'<button class="knapp" type="button" data-lagre-internt>Lagre notat</button>':''}</details>
          ${skriv_?`<footer>${f.status==='ny'?'<button class="knapp primar" type="button" data-status="under_arbeid">Jeg tar denne</button>':''}${f.status!=='ferdig'?'<button class="knapp" type="button" data-status="ferdig">Ferdig</button>':'<button class="knapp" type="button" data-status="under_arbeid">Åpne igjen</button>'}<button class="knapp" type="button" data-til-plan>Legg i planen</button></footer>`:''}
        </article>`}).join(''):`<p class="tom-fors">${forsFilter==='ny'||forsFilter==='aktive'?'Ingen åpne forespørsler akkurat nå.':'Ingen forespørsler her.'}</p>`}</div>`;
    if(fokus){const ta=$(`.fors-kort[data-fors="${fokus.id}"] .internt`);if(ta){ta.value=fokus.v;ta.focus({preventScroll:true})}}
  }
  $('#s-fors').addEventListener('click',e=>{
    const fb=e.target.closest('[data-fors-filter]');if(fb){forsFilter=fb.dataset.forsFilter;tegnFors();return}
    const kort=e.target.closest('.fors-kort');if(!kort)return;const f=D.foresporsler.find(x=>x.id===kort.dataset.fors);if(!f)return;
    const st=e.target.closest('[data-status]');
    if(st){const ny=st.dataset.status,for_={status:f.status,status_av:f.status_av,status_tid:f.status_tid};Object.assign(f,{status:ny,status_av:meEpost,status_tid:new Date().toISOString()});tegnFors();render();
      skriv(['foresporsler'],()=>sb.from('foresporsler').update({status:ny}).eq('id',f.id),ny==='ferdig'?`fullførte forespørselen fra ${f.navn}`:ny==='under_arbeid'&&for_.status==='ny'?`tok forespørselen fra ${f.navn}`:`åpnet forespørselen fra ${f.navn} igjen`,()=>Object.assign(f,for_));return}
    if(e.target.closest('[data-lagre-internt]')){const v=kort.querySelector('.internt').value.trim();if(v===(f.internt||''))return;skriv(['foresporsler'],()=>sb.from('foresporsler').update({internt:v}).eq('id',f.id),null).then(ok=>{if(ok)status('Notatet er lagret')});return}
    if(e.target.closest('[data-til-plan]')){
      const prod=f.type==='produkt';
      const hva=prod?(Array.isArray(f.produkter)&&f.produkter[0]?f.produkter[0].navn+(f.produkter.length>1?` + ${f.produkter.length-1} til`:''):'produkt'):[f.kategori,f.merke,f.modell].filter(Boolean).join(' ');
      const tittel=(prod?`Ring ${f.navn} – ${hva}`:`Service: ${hva} (${f.navn})`).slice(0,120);
      const notat=[`Tlf. ${f.telefon}`,f.nr?`Forespørsel ${f.nr}`:'',f.melding||''].filter(Boolean).join('\n').slice(0,1000);
      let dag=(new Date().getDay()+6)%7, uke=mandagFor(new Date());
      if(!prod&&f.onsket_dato){const d=new Date(f.onsket_dato+'T12:00');if(d>=uke){uke=mandagFor(d);dag=(d.getDay()+6)%7}}
      mandag=uke;valgtDag=Math.min(dag,6);velgSeksjon('plan');
      apneOppgave(null,dag,false,{tittel,notat,type:prod?'bestilling':'verksted'});return}
    const bl=e.target.closest('[data-bilde]');if(bl){$('#bilde-innhold').innerHTML=`<img src="${esc(bildeUrl[bl.dataset.bilde])}" alt="Bilde fra kunden" style="width:100%;border-radius:6px"><div class="dlg-knapper"><a class="knapp" href="${esc(bildeUrl[bl.dataset.bilde])}" target="_blank" rel="noopener">Åpne i full størrelse</a><button class="knapp primar" type="button" id="b-lukk">Lukk</button></div>`;$('#b-lukk').onclick=()=>$('#bilde-dlg').close();$('#bilde-dlg').showModal()}
  });

  // ---------- data ----------
  const SPORRINGER={
    ansatte:()=>sb.from('ansatte').select('id,navn,email,admin').order('navn'),
    faste:()=>sb.from('faste').select('*'),
    oppgaver:()=>sb.from('oppgaver').select('*').gte('uke',grenseUke()),
    uker:()=>sb.from('uker').select('*').gte('uke',grenseUke()),
    ferdig_faste:()=>sb.from('ferdig_faste').select('*').gte('uke',grenseUke()),
    hopp_over:()=>sb.from('hopp_over').select('*').gte('uke',grenseUke()),
    endringer:()=>sb.from('endringer').select('*').order('tid',{ascending:false}).limit(40),
    timer:()=>sb.from('timer').select('*').gte('inn',new Date(Date.now()-400*864e5).toISOString()).order('inn',{ascending:false}),
    foresporsler:()=>sb.from('foresporsler').select('*').order('mottatt',{ascending:false}).limit(500),
  };
  async function hent(tabeller=Object.keys(SPORRINGER)){
    const kjente=new Set(D.foresporsler.map(f=>f.id));
    const svar=await Promise.all([...new Set(tabeller)].map(async t=>[t,await SPORRINGER[t]()]));
    for(const [t,r] of svar){if(r.error)throw r.error;D[t]=r.data||[]}
    if(tabeller.includes('ansatte'))oppdaterMeg();
    if(lastet&&tabeller.includes('foresporsler')){const nye=D.foresporsler.filter(f=>!kjente.has(f.id)&&f.status==='ny');if(nye.length)status(nye.length===1?`Ny forespørsel fra ${nye[0].navn}`:`${nye.length} nye forespørsler`)}
    lagreKopi();render();
  }
  function oppdaterMeg(){meg=D.ansatte.find(a=>a.email===meEpost)||null}
  function lagreKopi(){try{lsSett('ukeplan-kopi:'+meEpost,JSON.stringify(D))}catch(e){}}
  function lesKopi(){try{const k=JSON.parse(lsHent('ukeplan-kopi:'+meEpost)||'null');if(k&&k.oppgaver)D={...D,...k}}catch(e){}}

  // live updates: refetch the table that changed (debounced)
  let kanal=null;const venterPaa=new Set();let hentTimer=0;
  function lytt(){
    if(kanal)sb.removeChannel(kanal);
    kanal=sb.channel('ukeplan').on('postgres_changes',{event:'*',schema:'public'},p=>{
      if(!SPORRINGER[p.table])return;venterPaa.add(p.table);clearTimeout(hentTimer);
      hentTimer=setTimeout(()=>{const t=[...venterPaa];venterPaa.clear();hent(t).then(()=>{if(t.includes('ansatte')&&!meg)visIngen()}).catch(()=>{})},250);
    }).subscribe();
  }
  // phones pause apps in the background; catch up when the app comes back
  let sistHentet=0;
  async function oppfrisk(){if(!sb||!meEpost||!nett||Date.now()-sistHentet<3000)return;sistHentet=Date.now();idag=osloIdag();try{await hent();feilTekst='';if(!meg)visIngen()}catch(e){}}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')oppfrisk()});
  addEventListener('online',()=>{nett=true;render();oppfrisk()});
  addEventListener('offline',()=>{nett=false;render()});

  // ---------- login ----------
  let modus='inn';
  function settModus(m){
    modus=m;$('#fane-inn').setAttribute('aria-selected',m==='inn');$('#fane-ny').setAttribute('aria-selected',m==='ny');
    $('#login-hjelp').textContent=m==='inn'?'Logg inn med e-posten og passordet ditt.':'Første gang? Bruk e-posten sjefen har lagt inn for deg, og velg et passord.';
    $('#login-knapp').textContent=m==='inn'?'Logg inn':'Lag konto';
    $('#l-passord').autocomplete=m==='inn'?'current-password':'new-password';
    $('#passord-hint').hidden=m==='inn';$('#login-feil').hidden=true;
  }
  $('#fane-inn').onclick=()=>settModus('inn');$('#fane-ny').onclick=()=>settModus('ny');
  $('#glemt').onclick=()=>{$('#glemt-info').hidden=!$('#glemt-info').hidden};
  function norskAuthFeil(e){
    const m=(e&&e.message)||'';
    if(/invalid login credentials/i.test(m))return 'Feil e-post eller passord.';
    if(/already registered|already exists/i.test(m))return 'Denne e-posten har allerede en konto. Velg «Logg inn».';
    if(/password.*(at least|short|weak)|weak password/i.test(m))return 'Passordet er for svakt. Bruk minst 8 tegn, gjerne med tall.';
    if(/email not confirmed/i.test(m))return 'E-posten er ikke bekreftet. Be sjefen slå av «Confirm email» i Supabase.';
    if(/invalid.*email|unable to validate email/i.test(m))return 'E-posten ser ikke riktig ut.';
    if(/rate limit|too many/i.test(m))return 'For mange forsøk. Vent litt og prøv igjen.';
    if(/fetch|network/i.test(m))return 'Får ikke kontakt. Sjekk nettet og prøv igjen.';
    return 'Noe gikk galt: '+m;
  }
  $('#login-skjema').addEventListener('submit',async e=>{
    e.preventDefault();
    const epost=$('#l-epost').value.trim().toLowerCase(),pass=$('#l-passord').value,fe=$('#login-feil'),k=$('#login-knapp');
    fe.hidden=true;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)){fe.textContent='Skriv e-posten din.';fe.hidden=false;return}
    if(pass.length<(modus==='ny'?8:1)){fe.textContent=modus==='ny'?'Passordet må ha minst 8 tegn.':'Skriv passordet ditt.';fe.hidden=false;return}
    k.disabled=true;const t=k.textContent;k.textContent='Vent litt …';
    try{
      const r=modus==='inn'?await sb.auth.signInWithPassword({email:epost,password:pass}):await sb.auth.signUp({email:epost,password:pass});
      if(r.error)throw r.error;
      if(!r.data.session){fe.textContent='Kontoen er laget, men må bekreftes på e-post. Be sjefen slå av «Confirm email» i Supabase, eller sjekk innboksen.';fe.hidden=false;return}
      await startInnlogget(r.data.session);
    }catch(err){fe.textContent=norskAuthFeil(err);fe.hidden=false}
    finally{k.disabled=false;k.textContent=t}
  });
  async function loggUt(){try{await sb.auth.signOut()}catch(e){}lsFjern('ukeplan-kopi:'+meEpost);meEpost=null;meg=null;lastet=false;if(kanal){sb.removeChannel(kanal);kanal=null}D=TOM();$('#l-passord').value='';settModus('inn');vis('skjerm-login')}
  function visIngen(){$('#ingen-epost').textContent=meEpost||'';vis('skjerm-ingen')}
  $('#ingen-igjen').onclick=async()=>{try{await hent(['ansatte']);if(meg){vis('app');await hent();lytt()}else status('Fortsatt ikke på listen.','feil')}catch(e){}};
  $('#ingen-ut').onclick=loggUt;

  async function startInnlogget(session){
    meEpost=(session.user.email||'').toLowerCase();
    lesKopi();oppdaterMeg();
    if(meg){vis('app');render()}
    try{
      await hent();lastet=true;feilTekst='';
      if(!meg){visIngen();return}
      vis('app');render();lytt();
    }catch(e){
      if(meg){lastet=true;feilTekst=nett?'Får ikke kontakt med databasen akkurat nå. Prøver igjen når appen åpnes.':'';render()}
      else{vis('skjerm-login');$('#login-feil').textContent='Får ikke kontakt. Sjekk nettet og prøv igjen.';$('#login-feil').hidden=false}
    }
  }

  // the on-screen keyboard shrinks only the visible area; size windows to it so they can scroll
  const vv=window.visualViewport;
  function tilpass(){const r=document.documentElement.style;if(vv){r.setProperty('--vvh',vv.height+'px');r.setProperty('--vvtop',vv.offsetTop+'px')}}
  if(vv){vv.addEventListener('resize',tilpass);vv.addEventListener('scroll',tilpass);tilpass()}
  document.addEventListener('focusin',e=>{const d=e.target.closest&&e.target.closest('dialog');if(d&&e.target.matches('input,textarea,select'))setTimeout(()=>e.target.scrollIntoView({block:'nearest'}),280)});

  // ---------- start ----------
  async function start(){
    const C=window.UKEPLAN_CONFIG||{};
    if(!C.supabaseUrl||!C.supabaseAnonKey||!window.supabase){vis('skjerm-oppsett');return}
    sb=window.supabase.createClient(C.supabaseUrl,C.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'ukeplan-auth'}});
    let session=null;
    try{session=(await sb.auth.getSession()).data.session}catch(e){}
    if(session)await startInnlogget(session);else{settModus('inn');vis('skjerm-login')}
    sb.auth.onAuthStateChange((ev,s)=>{if(ev==='SIGNED_OUT'&&meEpost){meEpost=null;vis('skjerm-login')}});
  }
  start();

  if('serviceWorker' in navigator&&location.protocol==='https:')addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();
