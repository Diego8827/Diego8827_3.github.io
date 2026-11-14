var cart={},cat="Todos",term="";
function $(i){return document.getElementById(i)}
function bs(n){return "Bs "+n.toFixed(2)}
function pr(p){return p.o||p.p}
function toast(t){var e=$("toast");e.textContent=t;e.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(function(){e.classList.remove("on")},1700)}
function chips(){var cs=["Todos"].concat(P.map(function(p){return p.c}).filter(function(c,i,a){return a.indexOf(c)===i}));
 $("chips").innerHTML=cs.map(function(c){return '<button class="chip" aria-pressed="'+(c===cat)+'" data-c="'+c+'">'+c+'</button>'}).join("")}
function grid(){
 var r=P.filter(function(p){return (cat==="Todos"||p.c===cat)&&(!term||(p.n+" "+p.d).toLowerCase().indexOf(term)>-1)});
 $("grid").innerHTML=r.length?r.map(function(p){return '<article class="card"><div class="tile" aria-hidden="true">'+(p.o?'<span class="badge">-'+Math.round((1-p.o/p.p)*100)+'%</span>':"")+p.e+'</div><div class="info"><h3>'+p.n+'</h3><p>'+p.d+'</p><div class="row"><span class="price"><b>'+bs(pr(p))+'</b>'+(p.o?'<s>'+bs(p.p)+'</s>':"")+'</span><button class="add" data-id="'+p.id+'">Agregar</button></div></div></article>'}).join(""):'<p class="empty">No encontramos productos con esa búsqueda.</p>';
}
function render(){
 var ids=Object.keys(cart),n=0,t=0,lines=[];
 $("items").innerHTML=ids.length?ids.map(function(id){var p=P.filter(function(x){return x.id==id})[0],q=cart[id];n+=q;t+=q*pr(p);lines.push(q+" x "+p.n+" ("+bs(q*pr(p))+")");
  return '<div class="it"><span class="e">'+p.e+'</span><div class="n">'+p.n+'<br><small>'+bs(pr(p))+'</small></div><div class="q"><button data-m="'+id+'" aria-label="Quitar uno">−</button><span>'+q+'</span><button data-a="'+id+'" aria-label="Agregar uno">+</button></div></div>'}).join(""):'<p class="empty">Tu carrito está vacío. Agrega productos para armar tu pedido.</p>';
 $("count").textContent=n;$("total").textContent=bs(t);
 var name=$("nm").value.trim(),w=$("wa");
 var text="Hola ROUDI, quiero hacer un pedido:\n"+lines.join("\n")+"\nTotal: "+bs(t)+"\nPunto de entrega: "+$("pt").value+"\nPago: "+$("pay").value+(name?"\nNombre: "+name:"");
 w.href="https://wa.me/"+WHATSAPP+"?text="+encodeURIComponent(text);
 w.classList.toggle("off",!ids.length||!name);
}
function drawer(o){$("drawer").classList.toggle("on",o);$("shade").classList.toggle("on",o);$("drawer").setAttribute("aria-hidden",!o)}
document.addEventListener("click",function(e){var t=e.target;
 if(t.dataset.c){cat=t.dataset.c;chips();grid()}
 if(t.dataset.id){cart[t.dataset.id]=(cart[t.dataset.id]||0)+1;render();toast("Agregado al carrito")}
 if(t.dataset.a){cart[t.dataset.a]++;render()}
 if(t.dataset.m){if(--cart[t.dataset.m]<1)delete cart[t.dataset.m];render()}
});
$("q").oninput=function(e){term=e.target.value.toLowerCase().trim();grid()};
$("open").onclick=function(){drawer(true)};
$("close").onclick=$("shade").onclick=function(){drawer(false)};
["nm","pt","pay"].forEach(function(i){$(i).oninput=render;$(i).onchange=render});
document.addEventListener("keydown",function(e){if(e.key==="Escape")drawer(false)});
$("pt").innerHTML=POINTS.map(function(p){return "<option>"+p+"</option>"}).join("");
chips();grid();render();
