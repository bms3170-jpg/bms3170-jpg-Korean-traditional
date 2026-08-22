
const $=s=>document.querySelector(s);
let products=[],orders=[],notices=[],deferredPrompt=null,realtimeChannel=null;
const statusLabel={new:"주문접수",paid:"입금확인",preparing:"상품준비중",shipping:"배송중",delivered:"배송완료",ready_for_pickup:"픽업준비완료",picked_up:"수령완료",cancelled:"취소"};
const paymentLabel={unpaid:"미입금",paid:"입금확인",refund_pending:"환불대기",refunded:"환불완료"};

function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function toast(message,type="ok"){let e=$("#owner-toast");if(!e){e=document.createElement("div");e.id="owner-toast";document.body.appendChild(e)}e.textContent=(type==="ok"?"✓ ":"")+message;e.className="owner-toast "+type+" show";clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>e.classList.remove("show"),3000)}
async function role(uid){const{data}=await supabaseClient.from("admin_users").select("role").eq("user_id",uid).maybeSingle();return data?.role}

async function show(session){
  if(!session){$("#login-panel").hidden=false;$("#dashboard").hidden=true;return}
  if(await role(session.user.id)!=="owner"){await supabaseClient.auth.signOut();$("#login-msg").textContent="owner 권한이 없는 계정입니다.";return}
  $("#login-panel").hidden=true;$("#dashboard").hidden=false;await refreshAll();startRealtime();
}

$("#login-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const{data,error}=await supabaseClient.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});
  if(error){$("#login-msg").textContent="로그인 정보를 확인해 주세요.";return}
  await show(data.session);
});
$("#logout").onclick=async()=>{await supabaseClient.auth.signOut();location.reload()};
$("#refresh-all").onclick=refreshAll;

async function refreshAll(){await Promise.all([loadSettings(),loadProducts(),loadOrders(),loadNotices()]);metrics()}

async function loadSettings(){
  const{data}=await supabaseClient.from("store_settings").select("*").eq("id",1).single();if(!data)return;
  [["#sale-title","sale_title"],["#sale-start","sale_start"],["#sale-end","sale_end"],["#site-notice","site_notice"],["#shipping-fee","shipping_fee"],["#free-shipping","free_shipping_threshold"],["#bank-name","bank_name"],["#account-number","account_number"],["#account-holder","account_holder"],["#store-phone","phone"]].forEach(([i,k])=>$(i).value=data[k]??"");
}
$("#settings-form").onsubmit=async e=>{
  e.preventDefault();
  if($("#sale-start").value>$("#sale-end").value){$("#settings-msg").textContent="종료일은 시작일보다 뒤여야 합니다.";return}
  const p={id:1,sale_title:$("#sale-title").value.trim(),sale_start:$("#sale-start").value,sale_end:$("#sale-end").value,site_notice:$("#site-notice").value.trim(),shipping_fee:Number($("#shipping-fee").value||0),free_shipping_threshold:Number($("#free-shipping").value||0),bank_name:$("#bank-name").value.trim(),account_number:$("#account-number").value.trim(),account_holder:$("#account-holder").value.trim(),phone:$("#store-phone").value.trim(),updated_at:new Date().toISOString()};
  const{error}=await supabaseClient.from("store_settings").upsert(p);
  if(error){$("#settings-msg").textContent="저장 실패";toast("저장에 실패했습니다.","error")}else{$("#settings-msg").textContent="";toast("설정이 저장되었습니다.")}
};
$("#force-close").onclick=async()=>{
  const r=prompt("조기 종료 사유","품절로 예약판매가 조기 종료되었습니다.");if(r===null||!confirm("정말 즉시 종료할까요?"))return;
  await supabaseClient.from("store_settings").update({sale_force_closed:true,sale_closed_reason:r}).eq("id",1);toast("예약판매를 종료했습니다.");
};
$("#reopen-sale").onclick=async()=>{
  if(!confirm("즉시 종료 상태를 해제할까요?"))return;
  await supabaseClient.from("store_settings").update({sale_force_closed:false,sale_closed_reason:""}).eq("id",1);toast("즉시종료를 해제했습니다.");
};

async function loadProducts(){const{data}=await supabaseClient.from("products").select("*").order("sort_order");products=data||[];renderProducts()}
function renderProducts(){
  $("#product-list").innerHTML="";
  products.forEach(p=>{
    const r=document.createElement("div");r.className="product-row";r.dataset.id=p.id||"";
    r.innerHTML=`<input class="w" value="${esc(p.weight)}"><input class="price" type="number" min="0" value="${p.price||0}"><input class="stock" type="number" min="0" value="${p.stock??""}" placeholder="재고(빈칸=무제한)"><label class="check"><input class="active" type="checkbox" ${p.active!==false?"checked":""}>판매</label>`;
    $("#product-list").appendChild(r);
  });
}
$("#add-product").onclick=()=>{products.push({id:null,weight:"",price:0,stock:null,active:true,sort_order:products.length+1});renderProducts()};
$("#save-products").onclick=async()=>{
  const p=[...document.querySelectorAll(".product-row")].map((r,i)=>({...(r.dataset.id?{id:r.dataset.id}:{}),weight:r.querySelector(".w").value.trim(),price:Number(r.querySelector(".price").value||0),stock:r.querySelector(".stock").value===""?null:Number(r.querySelector(".stock").value),active:r.querySelector(".active").checked,sort_order:i+1}));
  const{error}=await supabaseClient.from("products").upsert(p);
  if(error)toast("상품 저장에 실패했습니다.","error");else{toast("상품이 저장되었습니다.");await loadProducts()}
};

async function loadNotices(){
  const{data,error}=await supabaseClient
    .from("notices")
    .select("*")
    .order("pinned",{ascending:false})
    .order("created_at",{ascending:false});

  if(error){
    console.error("공지 불러오기 오류:",error);
    toast("공지사항을 불러오지 못했습니다.","error");
    return;
  }

  notices=data||[];
  renderNotices();
}

function renderNotices(){
  const box=$("#notice-list");
  box.innerHTML="";

  if(!notices.length){
    const empty=document.createElement("p");
    empty.className="helper";
    empty.textContent="등록된 공지가 없습니다. 오른쪽 위 '공지 추가'를 눌러 새 공지를 작성하세요.";
    box.appendChild(empty);
    return;
  }

  notices.forEach((n,index)=>{
    const r=document.createElement("div");
    r.className="notice-row";
    r.dataset.id=n.id||"";
    r.dataset.tempIndex=String(index);

    r.innerHTML=`
      <div class="field">
        <label>공지 제목</label>
        <input class="nt" placeholder="예: 추석 예약판매 안내" value="${esc(n.title)}">
      </div>
      <div class="field">
        <label>공지 내용</label>
        <input class="nb" placeholder="고객에게 보여줄 내용을 입력하세요." value="${esc(n.body)}">
      </div>
      <label class="check"><input class="na" type="checkbox" ${n.active!==false?"checked":""}>공개</label>
      <label class="check"><input class="np" type="checkbox" ${n.pinned?"checked":""}>고정</label>
      <button class="danger delete-notice" type="button">삭제</button>
    `;

    r.querySelector(".delete-notice").onclick=async()=>{
      if(!confirm("이 공지를 삭제하시겠습니까?")) return;

      if(!n.id){
        notices.splice(index,1);
        renderNotices();
        toast("작성 중인 공지를 삭제했습니다.");
        return;
      }

      const{error}=await supabaseClient.from("notices").delete().eq("id",n.id);
      if(error){
        console.error("공지 삭제 오류:",error);
        toast("공지 삭제에 실패했습니다.","error");
        return;
      }

      toast("공지를 삭제했습니다.");
      await loadNotices();
    };

    box.appendChild(r);
  });
}

$("#add-notice").onclick=()=>{
  notices.unshift({
    id:null,
    title:"",
    body:"",
    active:true,
    pinned:false,
    __new:true
  });
  renderNotices();

  requestAnimationFrame(()=>{
    document.querySelector(".notice-row .nt")?.focus();
  });
};

$("#save-notices").onclick=async()=>{
  const rows=[...document.querySelectorAll(".notice-row")];

  if(!rows.length){
    toast("저장할 공지가 없습니다.","error");
    return;
  }

  const existing=[];
  const fresh=[];

  for(const r of rows){
    const title=r.querySelector(".nt").value.trim();
    const body=r.querySelector(".nb").value.trim();
    const active=r.querySelector(".na").checked;
    const pinned=r.querySelector(".np").checked;

    if(!title) continue;

    const item={title,body,active,pinned,updated_at:new Date().toISOString()};

    if(r.dataset.id){
      existing.push({id:r.dataset.id,...item});
    }else{
      fresh.push(item);
    }
  }

  try{
    // 기존 공지는 ID 기준으로 각각 UPDATE
    for(const item of existing){
      const{id,...changes}=item;
      const{error}=await supabaseClient
        .from("notices")
        .update(changes)
        .eq("id",id);

      if(error) throw error;
    }

    // 새 공지는 각각 INSERT
    // 기존 공지와 신규 공지를 한 upsert 배열에 섞지 않도록 분리한다.
    for(const item of fresh){
      const{error}=await supabaseClient
        .from("notices")
        .insert(item);

      if(error) throw error;
    }

    await loadNotices();
    toast(`공지 ${existing.length+fresh.length}개가 저장되었습니다.`);
  }catch(error){
    console.error("공지 저장 오류:",error);
    toast("공지 저장에 실패했습니다. 다시 시도해 주세요.","error");
  }
};

async function loadOrders(){
  const{data,error}=await supabaseClient.from("orders").select("*, products(weight)").order("created_at",{ascending:false});
  if(error){console.error(error);return}
  orders=data||[];renderOrders();metrics();
}
function filtered(){
  const q=$("#order-search").value.trim().toLowerCase(),r=$("#receive-filter").value,s=$("#status-filter").value,p=$("#payment-filter").value;
  return orders.filter(o=>(r==="all"||o.receive===r)&&(s==="all"||o.status===s)&&(p==="all"||o.payment_status===p)&&(!q||[o.order_number,o.customer_name,o.phone].some(v=>String(v||"").toLowerCase().includes(q))));
}
function opts(o){
  const a=o.receive==="delivery"?[["new","주문접수"],["paid","입금확인"],["preparing","상품준비중"],["shipping","배송중"],["delivered","배송완료"],["cancelled","취소"]]:[["new","주문접수"],["paid","입금확인"],["preparing","상품준비중"],["ready_for_pickup","픽업준비완료"],["picked_up","수령완료"],["cancelled","취소"]];
  return a.map(([v,l])=>`<option value="${v}" ${o.status===v?"selected":""}>${l}</option>`).join("");
}
function renderOrders(){
  $("#order-list").innerHTML="";
  filtered().forEach(o=>{
    const c=document.createElement("article");c.className="order-card";
    c.innerHTML=`<div class="order-head"><div><span class="badge">${o.receive==="delivery"?"배송":"픽업"}</span> <span class="order-number">${esc(o.order_number)}</span><div class="order-date">${new Date(o.created_at).toLocaleString("ko-KR")}</div></div><span class="badge">${statusLabel[o.status]||o.status}</span></div>
      <div class="order-info">
        <div><span>주문자</span><strong>${esc(o.customer_name)}</strong></div><div><span>전화번호</span><strong>${esc(o.phone)}</strong></div>
        <div><span>상품</span><strong>${esc(o.products?.weight||"-")} × ${o.quantity}</strong></div><div><span>금액</span><strong>${Number(o.total_price).toLocaleString()}원</strong></div>
        <div><span>입금자</span><strong>${esc(o.depositor_name)}</strong></div><div><span>결제</span><strong>${paymentLabel[o.payment_status]||o.payment_status}</strong></div>
        <div><span>환불은행</span><strong>${esc(o.refund_bank||"-")}</strong></div><div><span>환불계좌</span><strong>${esc(o.refund_account||"-")}</strong></div>
      </div>
      ${o.receive==="delivery"?`<div class="detail"><strong>배송지</strong> ${esc(o.address||"-")}</div>`:""}
      ${o.cancel_request_reason?`<div class="detail"><strong>고객 취소 사유</strong> ${esc(o.cancel_request_reason)}</div>`:""}
      ${o.cancel_rejection_reason?`<div class="detail"><strong>취소 거절 사유</strong> ${esc(o.cancel_rejection_reason)}</div>`:""}
      ${o.admin_cancel_reason?`<div class="detail"><strong>관리자 취소 사유</strong> ${esc(o.admin_cancel_reason)}</div>`:""}
      <div class="order-controls">
        <div class="field"><label>주문상태</label><select class="status">${opts(o)}</select></div>
        <div class="field"><label>결제/환불</label><select class="payment"><option value="unpaid" ${o.payment_status==="unpaid"?"selected":""}>미입금</option><option value="paid" ${o.payment_status==="paid"?"selected":""}>입금확인</option><option value="refund_pending" ${o.payment_status==="refund_pending"?"selected":""}>환불대기</option><option value="refunded" ${o.payment_status==="refunded"?"selected":""}>환불완료</option></select></div>
        ${o.receive==="delivery"?`<div class="field"><label>택배사</label><select class="courier"><option value="">선택</option><option value="한진택배" ${o.courier==="한진택배"?"selected":""}>한진택배</option><option value="직접입력" ${o.courier&&o.courier!=="한진택배"?"selected":""}>직접 입력</option></select><input class="courier-custom" placeholder="택배사 직접 입력" value="${o.courier&&o.courier!=="한진택배"?esc(o.courier):""}" ${o.courier&&o.courier!=="한진택배"?"":"hidden"}></div><div class="field"><label>송장번호</label><input class="tracking" value="${esc(o.tracking_number||"")}"></div>`:"<div></div><div></div>"}
        <div class="field" style="grid-column:1/-1"><label>관리자 메모</label><input class="memo" value="${esc(o.admin_memo||"")}"></div>
      </div>
      <div class="actions"><button class="primary save">변경 저장</button></div><p class="message msg"></p>`;

    if(o.cancel_request_status==="pending"){
      const box=document.createElement("div");box.className="cancel-request-box";
      box.innerHTML=`<strong>⚠ 고객 취소 요청</strong><p>${esc(o.cancel_request_reason||"사유 없음")}</p><div class="actions"><button class="danger approve-cancel">취소 승인</button><button class="ghost reject-cancel">취소 거절</button></div>`;
      box.querySelector(".approve-cancel").onclick=async()=>{
        if(!confirm("취소를 승인할까요? 입금된 주문이면 환불대기로 자동 전환됩니다."))return;
        const{error}=await supabaseClient.rpc("respond_order_cancel",{p_order_id:o.id,p_approve:true,p_reason:""});
        if(error)toast(error.message||"취소 승인 실패","error");else{toast("취소를 승인했습니다.");await loadOrders()}
      };
      box.querySelector(".reject-cancel").onclick=async()=>{
        const reason=prompt("취소 거절 사유를 입력해 주세요.");if(reason===null)return;
        if(!reason.trim()){toast("거절 사유를 입력해 주세요.","error");return}
        const{error}=await supabaseClient.rpc("respond_order_cancel",{p_order_id:o.id,p_approve:false,p_reason:reason.trim()});
        if(error)toast(error.message||"취소 거절 실패","error");else{toast("취소 요청을 거절했습니다.");await loadOrders()}
      };
      c.prepend(box);
    }

    const courierSel=c.querySelector(".courier");
    if(courierSel)courierSel.addEventListener("change",()=>{const x=c.querySelector(".courier-custom");x.hidden=courierSel.value!=="직접입력";if(x.hidden)x.value=""});

    c.querySelector(".save").onclick=async()=>{
      const st=c.querySelector(".status").value,payment=c.querySelector(".payment").value;
      const payload={status:st,payment_status:payment,admin_memo:c.querySelector(".memo").value.trim()};
      if(o.receive==="delivery"){const cv=c.querySelector(".courier").value;payload.courier=cv==="직접입력"?c.querySelector(".courier-custom").value.trim():cv;payload.tracking_number=c.querySelector(".tracking").value.trim()}
      if(st==="cancelled"&&o.status!=="cancelled"){
        const reason=prompt("관리자 취소 사유를 입력해 주세요.");if(reason===null)return;
        if(!reason.trim()){toast("취소 사유를 입력해 주세요.","error");return}
        if(!confirm("주문을 취소할까요? 재고는 자동 복구됩니다."))return;
        payload.admin_cancel_reason=reason.trim();
      }
      const{error}=await supabaseClient.from("orders").update(payload).eq("id",o.id);
      if(error)toast("주문 저장에 실패했습니다.","error");else{toast("주문 상태가 저장되었습니다.");setTimeout(loadOrders,250)}
    };
    $("#order-list").appendChild(c);
  });
}
["#order-search","#receive-filter","#status-filter","#payment-filter"].forEach(i=>$(i).addEventListener(i==="#order-search"?"input":"change",renderOrders));
function metrics(){
  const vals=[["전체 주문",orders.length+"건"],["미입금",orders.filter(o=>o.payment_status==="unpaid"&&o.status!=="cancelled").length+"건"],["입금확인",orders.filter(o=>o.payment_status==="paid").length+"건"],["배송대기",orders.filter(o=>o.receive==="delivery"&&["paid","preparing"].includes(o.status)).length+"건"],["주문액",orders.filter(o=>o.status!=="cancelled").reduce((s,o)=>s+Number(o.total_price||0),0).toLocaleString()+"원"]];
  $("#metrics").innerHTML=vals.map(([k,v])=>`<div class="metric"><span>${k}</span><strong>${v}</strong></div>`).join("");
}

$("#csv-export").onclick=()=>{
  const rows=[["주문번호","접수일","주문자","전화번호","상품","수량","총금액","수령방법","상태","결제상태","환불은행","환불계좌","고객취소사유","취소거절사유","관리자취소사유","관리자메모"],...filtered().map(o=>[o.order_number,o.created_at,o.customer_name,o.phone,o.products?.weight||"",o.quantity,o.total_price,o.receive,statusLabel[o.status]||o.status,paymentLabel[o.payment_status]||o.payment_status,o.refund_bank,o.refund_account,o.cancel_request_reason,o.cancel_rejection_reason,o.admin_cancel_reason,o.admin_memo])];
  const csv="\ufeff"+rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n"),a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="철원민통선한과_주문.csv";a.click();
};

function startRealtime(){
  if(realtimeChannel)return;
  realtimeChannel=supabaseClient.channel("owner-orders-live").on("postgres_changes",{event:"*",schema:"public",table:"orders"},payload=>{
    loadOrders();
    if(payload.eventType==="INSERT")toast("새 주문이 들어왔습니다.");
    else if(payload.new?.cancel_request_status==="pending")toast("고객 취소 요청이 들어왔습니다.");
  }).subscribe();
}

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("#install-banner").hidden=false});
$("#install-btn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}};
if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js");
(async()=>{const{data:{session}}=await supabaseClient.auth.getSession();await show(session)})();
