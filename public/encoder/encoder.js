const _0x4a5_URL = "https://hallizar.ru/encoder/encoder_wasm_bg-C7lNWbiX.wasm.b64";
const _0x4a5_CACHE = "hallizar_gif_encoder_wasm_b64_v1";
const _0x4a5_LENGTH = 390316;
async function _0x4a4(){
 let payload = "";
 try { payload = localStorage.getItem(_0x4a5_CACHE) || ""; } catch (_) {}
 if (payload.length !== _0x4a5_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
   const response = await fetch(_0x4a5_URL, { cache: "no-store" });
   if (!response.ok) throw new Error("Не удалось загрузить локальный движок GIF. Проверьте интернет и перезапустите плагин.");
   payload = (await response.text()).trim();
   if (payload.length !== _0x4a5_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
     throw new Error("Загруженный движок GIF повреждён или имеет неверный формат.");
   }
   try { localStorage.setItem(_0x4a5_CACHE, payload); } catch (_) {}
 }
 const binary = atob(payload);
 const bytes = new Uint8Array(binary.length);
 for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
 return bytes;
}
let dt;const Nd=typeof TextDecoder<"u"?new TextDecoder("utf-8",{ignoreBOM:!0,fatal:!0}):{decode:()=>{throw Error("TextDecoder not available")}};typeof TextDecoder<"u"&&Nd.decode();let Au=null;function mf(){return(Au===null||Au.byteLength===0)&&(Au=new Uint8Array(dt.memory.buffer)),Au}function fy(d,S){return d=d>>>0,Nd.decode(mf().subarray(d,d+S))}let Zn=0;function sy(d,S){const N=S(d.length*1,1)>>>0;return mf().set(d,N/1),Zn=d.length,N}function Jt(d){return d==null}let pu=null;function oy(){return(pu===null||pu.byteLength===0)&&(pu=new Uint32Array(dt.memory.buffer)),pu}function ry(d,S){const N=S(d.length*4,4)>>>0;return oy().set(d,N/4),Zn=d.length,N}let _u=null;function Sd(){return(_u===null||_u.byteLength===0)&&(_u=new Int32Array(dt.memory.buffer)),_u}function dy(d,S){return d=d>>>0,mf().subarray(d/1,d/1+S)}function hy(d,S,N,r,R,O,L,k,j,T){try{const ol=dt.__wbindgen_add_to_stack_pointer(-16),jl=sy(d,dt.__wbindgen_malloc),Nl=Zn;var H=Jt(O)?0:ry(O,dt.__wbindgen_malloc),tl=Zn;dt.encode(ol,jl,Nl,S,N,r,Jt(R)?16777215:R,H,tl,Jt(L)?16777215:L,!Jt(k),Jt(k)?0:k,!Jt(j),Jt(j)?0:j,!Jt(T),Jt(T)?0:T);var P=Sd()[ol/4+0],sl=Sd()[ol/4+1],ml=dy(P,sl).slice();return dt.__wbindgen_free(P,sl*1,1),ml}finally{dt.__wbindgen_add_to_stack_pointer(16)}}async function yy(d,S){if(typeof Response=="function"&&d instanceof Response){if(typeof WebAssembly.instantiateStreaming=="function")try{return await WebAssembly.instantiateStreaming(d,S)}catch(r){if(d.headers.get("Content-Type")!="application/wasm")console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n",r);else throw r}const N=await d.arrayBuffer();return await WebAssembly.instantiate(N,S)}else{const N=await WebAssembly.instantiate(d,S);return N instanceof WebAssembly.Instance?{instance:N,module:d}:N}}function my(){const d={};return d.wbg={},d.wbg.__wbindgen_throw=function(S,N){throw new Error(fy(S,N))},d}function vy(d,S){return dt=d.exports,Od.__wbindgen_wasm_module=S,_u=null,pu=null,Au=null,dt}async function Od(d){if(dt!==void 0)return dt;typeof d>"u"&&(d=new URL("./encoder_wasm_bg-C7lNWbiX.wasm",import.meta.url));const S=my();(typeof d=="string"||typeof Request=="function"&&d instanceof Request||typeof URL=="function"&&d instanceof URL)&&(d=fetch(d));const{instance:N,module:r}=await yy(await d,S);return vy(N,r)}let rf;async function gy(d){return rf||(rf=Od(d)),rf}function by(d){const S=d.reduce((R,O)=>{const L="data"in O?O.data:O;return R+L.length},0),N=new Uint8Array(S);let r=0;return d.forEach(R=>{const O="data"in R?R.data:R;N.set(O,r),r+=O.length}),N}async function Sy(d,{frames:S,width:N,height:r,fps:R,frameDurations:O,quality:L,repeat:k,resizeWidth:j,resizeHeight:T}){if(S.length===1)throw new Error("At least 2 frames are required to encode a GIF with encoder");if("duration"in S[0]&&O)throw new Error("frameDurations cannot be provided when frames have durations");if("duration"in S[0]&&"imageData"in S[0]&&(O=S.map(ml=>{if("duration"in ml)return ml.duration;throw new Error("All frames must have a duration")}),S=S.map(ml=>{if("imageData"in ml)return ml.imageData;throw new Error("All frames must have an imageData")})),!R&&!O)throw new Error("Either fps or frameDurations must be provided");if(R&&O)throw new Error("fps and frameDurations cannot be provided at the same time");if(O&&O.length!==S.length)throw new Error("The number of frame durations must match the number of frames");const H=S.length,tl=by(S),P=O?new Uint32Array(O):void 0,sl=await d(tl,H,N,r,R,P,L,k,j,T);if(!sl)throw new Error("Encoding error.");return sl}

export default async function encodeGif(options) {
  if (dt === undefined) await Od(await _0x4a4());
  return Sy(hy, options);
}
