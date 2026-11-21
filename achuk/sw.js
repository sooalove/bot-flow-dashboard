// /achuk/sw.js — FCM 데이터 메시지 수신 → 알림 표시, 탭하면 전문 페이지 열기 (v3 2026-11-10: 팀 세팅=명단 위주 요약·탭하면 전문 msg.html / 경기 종료(kind=end)=결과 그대로·탭하면 그 경기 AOM 투표)
const EMO={'블루':'🔵','블랙':'⚫'};
function compact(t){const L=String(t||'').split('\n').map(s=>s.trim()).filter(Boolean);let teams=0;
  const o=L.filter(s=>!/^\d{1,2}\/\d{1,2}$/.test(s)&&!/^스코어\s/.test(s)).map(s=>{const m=s.match(/^(\S+)\s+:\s*(.*)$/);
    if(m){teams++;return (EMO[m[1]]||'⚪')+' '+m[1]+': '+m[2].split(/\s+/).filter(Boolean).join(', ')}
    return s.replace(/^\*용병은 지인과 우선적으로 동일팀에 배치$/,'*용병은 지인과 같은 팀 우선')});
  return teams?o.join('\n'):String(t||'')}
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(_){}
  const x=d.data||d;const title=x.title||'아축 팀 세팅';const body=x.body||'';
  if(x.kind==='end'){const q='./?tab=in&go=vote'+(/^\d{4}-\d{2}-\d{2}$/.test(x.d||'')?'&d='+x.d:'')+(x.mid?'&m='+encodeURIComponent(x.mid):'');
    return e.waitUntil(self.registration.showNotification(title||'아축 경기 종료',{body,tag:'achuk-end-'+(x.mid||''),data:{url:q}}))}
  e.waitUntil(self.registration.showNotification(title,{body:compact(body),tag:'achuk-team-'+(x.mid||''),data:{url:'./push/msg.html?m='+encodeURIComponent(x.mid||'')+'#'+encodeURIComponent(body)}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.openWindow(new URL(e.notification.data.url,self.registration.scope).href))});
self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(clients.claim()));
