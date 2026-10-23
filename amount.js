(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory();else root.KVAmount=factory()})(typeof globalThis!=="undefined"?globalThis:this,function(){
 const ones=["","bir","ikki","uch","toʻrt","besh","olti","yetti","sakkiz","toʻqqiz"];
 const teens=["oʻn","oʻn bir","oʻn ikki","oʻn uch","oʻn toʻrt","oʻn besh","oʻn olti","oʻn yetti","oʻn sakkiz","oʻn toʻqqiz"];
 const tens=["","","yigirma","oʻttiz","qirq","ellik","oltmish","yetmish","sakson","toʻqson"];
 function group(n){let w=[];let h=Math.floor(n/100),r=n%100;if(h)w.push(ones[h],"yuz");if(r>=10&&r<20)w.push(teens[r-10]);else{let t=Math.floor(r/10),u=r%10;if(t)w.push(tens[t]);if(u)w.push(ones[u])}return w.join(" ")}
 function spellAmount(input){let n=Number(input);if(!Number.isSafeInteger(n)||n<=0||n>999999999)return "";let m=Math.floor(n/1000000),th=Math.floor(n/1000)%1000,r=n%1000,w=[];if(m)w.push(group(m),"million");if(th)w.push(group(th),"ming");if(r)w.push(group(r));return w.join(" ")+" soʻm"}
 return {spellAmount};
});
