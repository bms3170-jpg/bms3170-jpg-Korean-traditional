
const STATUS={new:"주문접수",paid:"입금확인",preparing:"상품준비중",shipping:"배송중",delivered:"배송완료",ready_for_pickup:"픽업준비완료",picked_up:"수령완료",cancelled:"주문 취소"};
const PAYMENT={unpaid:"미입금",paid:"입금확인",refund_pending:"환불대기",refunded:"환불완료"};
let currentOrder=null;

function steps(r){return r==="delivery"?[["new","주문접수"],["paid","입금확인"],["preparing","상품준비중"],["shipping","배송중"],["delivered","배송완료"]]:[["new","주문접수"],["paid","입금확인"],["preparing","상품준비중"],["ready_for_pickup","픽업준비완료"],["picked_up","수령완료"]]}
function timeline(o){
  const b=document.querySelector("#timeline"),l=steps(o.receive),c=l.findIndex(([v])=>v===o.status);b.innerHTML="";
  if(o.status==="cancelled"){b.innerHTML='<div class="timeline-step done"><span class="timeline-dot">✓</span><span>주문 취소</span></div>';return}
  l.forEach(([v,x],i)=>{const d=document.createElement("div");d.className=`timeline-step ${i<=c?"done":""}`;d.innerHTML=`<span class="timeline-dot">${i<=c?"✓":i+1}</span><span>${x}</span>`;b.appendChild(d)});
}
function renderPayment(o){
  const box=document.querySelector("#payment-box");
  let text=PAYMENT[o.payment_status]||o.payment_status||"-";
  if(o.payment_status==="refund_pending")text+=" · 환불을 처리 중입니다.";
  if(o.payment_status==="refunded")text+=" · 환불이 완료되었습니다.";
  box.innerHTML=`<h3>결제·환불 상태</h3><p><strong>${text}</strong></p>`;
}
function renderCancelInfo(o){
  const box=document.querySelector("#cancel-info-box");box.hidden=true;box.innerHTML="";
  if(o.status==="cancelled"){
    const reason=o.admin_cancel_reason||o.cancel_request_reason||"";
    box.hidden=false;
    box.innerHTML=`<strong>주문이 취소되었습니다.</strong>${reason?`<p>취소 사유: ${reason}</p>`:""}`;
  }else if(o.cancel_request_status==="pending"){
    box.hidden=false;box.innerHTML=`<strong>취소 요청 확인 중</strong><p>관리자가 취소 요청을 확인하고 있습니다.${o.cancel_request_reason?`<br>요청 사유: ${o.cancel_request_reason}`:""}</p>`;
  }else if(o.cancel_request_status==="rejected"){
    box.hidden=false;box.innerHTML=`<strong>취소 요청이 거절되었습니다.</strong><p>${o.cancel_rejection_reason?`거절 사유: ${o.cancel_rejection_reason}`:"자세한 내용은 판매자에게 문의해 주세요."}</p>`;
  }
}
async function lookup(){
  const er=document.querySelector("#lookup-error");er.textContent="";
  const num=document.querySelector("#order-number").value.trim().toUpperCase(),phone=document.querySelector("#lookup-phone").value.trim();
  const{data,error}=await window.supabaseClient.rpc("lookup_order",{p_order_number:num,p_phone:phone});
  if(error){er.textContent="조회 중 오류가 발생했습니다.";return}
  const o=Array.isArray(data)?data[0]:data;if(!o){er.textContent="일치하는 주문을 찾지 못했습니다.";return}
  currentOrder={...o,phone};
  document.querySelector("#lookup-status").textContent=STATUS[o.status]||o.status;
  const rows=[["주문번호",o.order_number],["주문일",new Date(o.created_at).toLocaleString("ko-KR")],["상품",o.weight],["수량",`${o.quantity}개`],["총금액",Hangwa.formatMoney(o.total_price)],["수령방법",o.receive==="delivery"?"배송":"픽업"],...(o.receive==="delivery"?[["배송지",o.address||"-"]]:[])];
  document.querySelector("#lookup-summary").innerHTML=rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join("");
  renderPayment(o);renderCancelInfo(o);
  const t=document.querySelector("#tracking-box");
  if(o.receive==="delivery"&&(o.courier||o.tracking_number)){t.hidden=false;t.innerHTML=`<h3>배송 정보</h3><p>택배사: <strong>${o.courier||"미등록"}</strong></p><p>송장번호: <strong>${o.tracking_number||"미등록"}</strong></p>`}else t.hidden=true;
  timeline(o);
  const box=document.querySelector("#cancel-box"),btn=document.querySelector("#cancel-request-btn"),msg=document.querySelector("#cancel-status-msg");
  box.hidden=false;btn.hidden=false;btn.disabled=false;msg.textContent="";
  if(o.status==="cancelled"){btn.hidden=true;msg.textContent="취소된 주문입니다."}
  else if(["shipping","delivered","picked_up"].includes(o.status)){btn.hidden=true;msg.textContent="현재 단계에서는 온라인 취소가 어렵습니다. 판매자에게 문의해 주세요."}
  else if(o.cancel_request_status==="pending"){btn.disabled=true;btn.textContent="취소 요청 중";msg.textContent="관리자가 취소 요청을 확인 중입니다."}
  else{btn.textContent="주문 취소 요청";if(o.cancel_request_status==="rejected")msg.textContent="이전 취소 요청이 거절되었습니다. 필요하면 다시 요청할 수 있습니다."}
  document.querySelector("#lookup-result").hidden=false;
  document.querySelector("#lookup-result").scrollIntoView({behavior:"smooth"});
}
document.querySelector("#lookup-form").addEventListener("submit",async e=>{e.preventDefault();await lookup()});
document.querySelector("#cancel-request-btn").addEventListener("click",async()=>{
  if(!currentOrder)return;
  const reason=prompt("취소 사유를 입력해 주세요.");if(reason===null)return;
  if(!reason.trim()){alert("취소 사유를 입력해 주세요.");return}
  if(!confirm(`취소 사유\n${reason.trim()}\n\n이 내용으로 주문 취소를 요청할까요?`))return;
  const{data,error}=await window.supabaseClient.rpc("request_order_cancel",{p_order_number:currentOrder.order_number,p_phone:currentOrder.phone,p_reason:reason.trim()});
  if(error){alert(error.message||"취소 요청에 실패했습니다.");return}
  alert(data==="cancelled"?"주문이 취소되었습니다.":"취소 요청이 접수되었습니다.");await lookup();
});
const p=new URLSearchParams(location.search);if(p.get("order"))document.querySelector("#order-number").value=p.get("order");if(p.get("phone"))document.querySelector("#lookup-phone").value=p.get("phone");
