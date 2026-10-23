(() => {
  const $ = id => document.getElementById(id), cfg=window.KV_CONFIG||{};
  const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseKey);
  const money=n=>new Intl.NumberFormat('uz-UZ').format(Number(n||0));
  const stamp=d=>new Intl.DateTimeFormat('uz-UZ',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(d));
  const dateLocal=()=>{const n=new Date();n.setMinutes(n.getMinutes()-n.getTimezoneOffset());return n.toISOString().slice(0,16)};
  let user=null,adminName='',receipts=[],current=null,filteredReceipts=[];
  const setStatus=(el,msg,error=false)=>{el.textContent=msg;el.hidden=!msg;el.classList.toggle('error',error)};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const showLogin=()=>{$('loginView').hidden=false;$('adminView').hidden=true;$('deniedView').hidden=true};
  const showDenied=()=>{$('loginView').hidden=true;$('adminView').hidden=true;$('deniedView').hidden=false};
  async function authorize(session){
    if(!session?.user){showLogin();return}
    user=session.user;
    const {data,error}=await client.from('kv_admins').select('full_name').eq('user_id',user.id).maybeSingle();
    if(error||!data){await client.auth.signOut();user=null;showDenied();return}
    adminName=data.full_name;$('adminName').textContent=adminName;$('loginView').hidden=true;$('deniedView').hidden=true;$('adminView').hidden=false;
    try{const last=localStorage.getItem('kvLastMethod');if(last&&[...$('method').options].some(o=>o.value===last))$('method').value=last}catch(_){}
    await loadReceipts();
  }
  $('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').hidden=true;const b=e.currentTarget.querySelector('button');b.disabled=true;const {data,error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});b.disabled=false;if(error){setStatus($('loginError'),'Email yoki parol notoʻgʻri',true);return}await authorize(data.session)});
  async function logout(){await client.auth.signOut();user=null;showLogin()}
  $('logout').onclick=logout;$('deniedLogout').onclick=logout;
  client.auth.getSession().then(({data})=>authorize(data.session));
  client.auth.onAuthStateChange((_event,session)=>{if(!session)showLogin()});
  document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===btn));$('createPane').hidden=btn.dataset.tab!=='create';$('listPane').hidden=btn.dataset.tab!=='list';if(btn.dataset.tab==='list')loadReceipts()});
  const amountDigits=()=>Number(($('amount').value||'').replace(/\D/g,''));
  $('amount').addEventListener('input',()=>{let d=$('amount').value.replace(/\D/g,'');$('amount').value=d?new Intl.NumberFormat('en-US').format(Number(d)).replace(/,/g,' '):'';const w=KVAmount.spellAmount(Number(d));$('amountWords').textContent=w||'Summani soʻz bilan koʻrsatish'});
  $('purpose').addEventListener('change',()=>{$('purposeOtherWrap').hidden=$('purpose').value!=='Boshqa';$('purposeOther').required=$('purpose').value==='Boshqa'});
  $('method').addEventListener('change',()=>{try{localStorage.setItem('kvLastMethod',$('method').value)}catch(_){}});
  $('phone').addEventListener('input',()=>{let d=$('phone').value.replace(/\D/g,'');if(d.startsWith('998'))d=d.slice(3);d=d.slice(0,9);$('phone').value=d?'+998 '+d.slice(0,2)+(d.length>2?' '+d.slice(2,5):'')+(d.length>5?' '+d.slice(5,7):'')+(d.length>7?' '+d.slice(7,9):''):''});
  $('paidAt').value=dateLocal();$('paidAt').max=dateLocal();
  $('receiptForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!user)return;
    const amount=amountDigits(),payer=$('payer').value.trim(),child=$('child').value.trim(),purpose=$('purpose').value,method=$('method').value;
    if(!Number.isSafeInteger(amount)||amount<=0){setStatus($('formStatus'),'Summani tekshiring',true);return}
    if(purpose==='Boshqa'&&!$('purposeOther').value.trim()){setStatus($('formStatus'),'Boshqa maqsadni yozing',true);return}
    const paidAt=new Date($('paidAt').value);if(Number.isNaN(paidAt.valueOf())||paidAt>new Date()){setStatus($('formStatus'),'Toʻlov sanasini tekshiring',true);return}
    const preview=`Toʻgʻrimi? ${money(amount)} soʻm — ${payer} — ${method}`;
    if(!window.confirm(preview))return;
    const since=new Date(Date.now()-10*60*1000).toISOString();
    const button=$('createButton');button.disabled=true;button.textContent='Tekshirilmoqda…';
    const dup=await client.from('kv_receipts').select('id,number').eq('payer_name',payer).eq('amount',amount).eq('purpose',purpose).gte('created_at',since).limit(1);
    if(!dup.error&&dup.data?.length&&!window.confirm('Oxirgi 10 daqiqada shunday kvitansiya bor. Baribir yaratamizmi?')){button.disabled=false;button.textContent='Kvitansiya yaratish';return}
    button.textContent='Yaratilmoqda…';setStatus($('formStatus'),'');
    const {data,error}=await client.rpc('kv_create_receipt',{p_payer_name:payer,p_child_name:child,p_phone:$('phone').value.trim()||null,p_purpose:purpose,p_purpose_other:$('purposeOther').value.trim()||null,p_amount:amount,p_method:method,p_contract_no:$('contractNo').value.trim()||null,p_paid_at:paidAt.toISOString()});
    button.disabled=false;button.textContent='Kvitansiya yaratish';
    if(error){setStatus($('formStatus'),'Kvitansiya yaratilmadi. Maʼlumotlarni tekshirib, qayta urinib koʻring.',true);return}
    const row=Array.isArray(data)?data[0]:data;if(!row){setStatus($('formStatus'),'Kvitansiya javobi olinmadi.',true);return}
    setStatus($('formStatus'),`№ ${String(row.number).padStart(6,'0')} kvitansiya yaratildi.`);e.currentTarget.reset();$('paidAt').value=dateLocal();$('purposeOtherWrap').hidden=true;$('amountWords').textContent='Summani soʻz bilan koʻrsatish';await loadReceipts();openReceipt(row);
  });
  function renderList(){
    const q=$('search').value.trim().toLocaleLowerCase('uz'),status=$('statusFilter').value,period=$('period').value;
    let from=null,to=null,now=new Date();if(period==='today'){from=new Date(now.getFullYear(),now.getMonth(),now.getDate())}else if(period==='week'){from=new Date(now);let wd=(now.getDay()+6)%7;from.setDate(now.getDate()-wd);from.setHours(0,0,0,0)}else if(period==='month'){from=new Date(now.getFullYear(),now.getMonth(),1)}else if(period==='custom'){if($('dateFrom').value)from=new Date($('dateFrom').value+'T00:00:00');if($('dateTo').value)to=new Date($('dateTo').value+'T23:59:59')}
    const filtered=receipts.filter(r=>{const s=[r.number,r.payer_name,r.child_name,r.phone,r.contract_no].join(' ').toLocaleLowerCase('uz');const d=new Date(r.paid_at);return(!q||s.includes(q))&&(status==='all'||r.status===status)&&(!from||d>=from)&&(!to||d<=to)});
    filteredReceipts=filtered;const active=filtered.filter(x=>x.status==='active');$('totals').textContent=`${filtered.length} ta kvitansiya · Faol summa: ${money(active.reduce((a,x)=>a+Number(x.amount),0))} soʻm`;
    const root=$('receiptList');root.replaceChildren();if(!filtered.length){root.innerHTML='<p class="empty">Kvitansiyalar topilmadi</p>';return}
    for(const r of filtered){const b=document.createElement('button');b.className='receipt-row';b.innerHTML=`<span class="receipt-row-main"><span>№ ${String(r.number).padStart(6,'0')} · ${esc(r.payer_name)}</span><span>${money(r.amount)} soʻm</span></span><span class="receipt-row-sub"><span>${esc(stamp(r.paid_at))} · ${esc(r.method)}</span><span class="badge ${r.status==='cancelled'?'cancelled':''}">${r.status==='cancelled'?'Bekor':'Faol'}</span></span>`;b.onclick=()=>openReceipt(r);root.append(b)}
  }
  async function loadReceipts(){if(!user)return;const {data,error}=await client.from('kv_receipts').select('*').order('paid_at',{ascending:false}).limit(1000);if(error){$('receiptList').innerHTML='<p class="empty">Roʻyxat yuklanmadi. Qayta urinib koʻring.</p>';return}receipts=data||[];renderList()}
  ['search','statusFilter','period','dateFrom','dateTo'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',()=>{$('customDates').hidden=$('period').value!=='custom';renderList()}));
  function rowPurpose(r){return r.purpose==='Boshqa'?r.purpose_other:r.purpose}
  async function openReceipt(r){current=r;$('receiptModal').hidden=false;$('rNumber').textContent=String(r.number).padStart(6,'0');$('rDate').textContent=stamp(r.paid_at);$('rPayer').textContent=r.payer_name;$('rChild').textContent=r.child_name;$('rPurpose').textContent=rowPurpose(r);$('rMethod').textContent=r.method;$('rAmount').textContent=money(r.amount);$('rWords').textContent=KVAmount.spellAmount(Number(r.amount));$('rAdmin').textContent=adminName;$('rFooter').textContent=cfg.receiptFooter||'';$('providerLines').replaceChildren();for(const [label,val] of [['Ijrochi',cfg.providerName],['STIR',cfg.stir],['Telefon',cfg.providerPhone]])if(val){const d=document.createElement('div'),s=document.createElement('small'),b=document.createElement('strong');s.textContent=label;b.textContent=val;d.append(s,b);$('providerLines').append(d)}$('contractLine').hidden=!r.contract_no;$('rContract').textContent=r.contract_no||'';$('cancelStamp').hidden=r.status!=='cancelled';$('cancelReceipt').hidden=r.status!=='active';$('openTelegram').hidden=!r.phone;setStatus($('receiptStatus'),'');const link=new URL('v.html',cfg.pagesUrl||location.href);link.searchParams.set('c',r.code);current.verifyUrl=link.href;await QRCode.toCanvas($('receiptQr'),link.href,{errorCorrectionLevel:'H',margin:4,width:360,color:{dark:'#1A2238',light:'#FFFFFF'}})}
  $('closeReceipt').onclick=()=>{$('receiptModal').hidden=true};$('receiptModal').addEventListener('click',e=>{if(e.target===$('receiptModal'))$('receiptModal').hidden=true});
  async function receiptPng(){return await html2canvas($('receiptCard'),{scale:3,backgroundColor:'#ffffff',useCORS:true,logging:false})}
  async function receiptFile(triggerDownload=false){const c=await receiptPng(),name=`kvitansiya-${String(current.number).padStart(6,'0')}.png`;if(triggerDownload){const a=document.createElement('a');a.href=c.toDataURL('image/png');a.download=name;a.click()}return new File([await new Promise(ok=>c.toBlob(ok,'image/png'))],name,{type:'image/png'})}async function downloadPng(){return receiptFile(true)}
  $('downloadPng').onclick=async()=>{try{await downloadPng()}catch(_){setStatus($('receiptStatus'),'PNG tayyorlanmadi.',true)}};
  $('downloadPdf').onclick=async()=>{try{const c=await receiptPng(),img=c.toDataURL('image/png'),{jsPDF}=window.jspdf,doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a5'}),pw=105,ph=148,scale=Math.min(pw/c.width,ph/c.height),w=c.width*scale,h=c.height*scale;doc.addImage(img,'PNG',(pw-w)/2,(ph-h)/2,w,h);doc.save(`kvitansiya-${String(current.number).padStart(6,'0')}.pdf`)}catch(_){setStatus($('receiptStatus'),'PDF tayyorlanmadi.',true)}};
  $('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText(current.verifyUrl);setStatus($('receiptStatus'),'Tekshirish havolasi nusxalandi.')}catch(_){window.prompt('Tekshirish havolasi',current.verifyUrl)}};
  $('shareTelegram').onclick=async()=>{try{const sample=new File(['x'],'share-test.png',{type:'image/png'}),supports=!!(navigator.share&&navigator.canShare?.({files:[sample]}));if(supports){const file=await receiptFile(false);await navigator.share({files:[file],title:`Toʻlov kvitansiyasi № ${String(current.number).padStart(6,'0')}`});return}const text=`Toʻlov kvitansiyasi № ${String(current.number).padStart(6,'0')}, ${money(current.amount)} soʻm`;window.open(`https://t.me/share/url?url=${encodeURIComponent(current.verifyUrl)}&text=${encodeURIComponent(text)}`,'_blank','noopener');await downloadPng();setStatus($('receiptStatus'),'PNG yuklab olindi. Telegram oynasida ota-onani tanlang va rasmni qoʻshing.')}catch(_){setStatus($('receiptStatus'),'Ulashish oynasi ochilmadi.',true)}};
  $('openTelegram').onclick=()=>{const digits=current.phone.replace(/\D/g,'');window.open(`https://t.me/+${digits}`,'_blank','noopener')};
  $('cancelReceipt').onclick=async()=>{const reason=window.prompt('Bekor qilish sababini kiriting:');if(reason===null)return;if(reason.trim().length<3){setStatus($('receiptStatus'),'Sabab kamida 3 ta belgidan iborat boʻlsin.',true);return}if(!window.confirm('Kvitansiyani bekor qilasizmi? Bu amal qaytarilmaydi.'))return;const b=$('cancelReceipt');b.disabled=true;const {data,error}=await client.rpc('kv_cancel_receipt',{p_receipt_id:current.id,p_reason:reason.trim()});b.disabled=false;if(error){setStatus($('receiptStatus'),'Bekor qilib boʻlmadi. Kvitansiya holatini tekshiring.',true);return}current=Array.isArray(data)?data[0]:data;$('cancelStamp').hidden=false;$('cancelReceipt').hidden=true;await loadReceipts();setStatus($('receiptStatus'),'Kvitansiya bekor qilindi. Sabab roʻyxatga yozildi.')};
  $('csvButton').onclick=()=>{const q=$('search').value.trim().toLocaleLowerCase('uz'),status=$('statusFilter').value;const rows=receipts.filter(r=>(!q||[r.number,r.payer_name,r.child_name,r.phone,r.contract_no].join(' ').toLocaleLowerCase('uz').includes(q))&&(status==='all'||r.status===status));const csv=[['№','Sana','Toʻlovchi','Bola','Telefon','Maqsad','Summa','Usul','Holat','Shartnoma'].map(csvCell).join(';'),...rows.map(r=>[String(r.number).padStart(6,'0'),stamp(r.paid_at),r.payer_name,r.child_name,r.phone||'',rowPurpose(r),r.amount,r.method,r.status==='active'?'Faol':'Bekor',r.contract_no||''].map(csvCell).join(';'))].join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`kvitansiyalar-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
  function csvCell(x){return '"'+String(x??'').replace(/"/g,'""')+'"'}
})();


