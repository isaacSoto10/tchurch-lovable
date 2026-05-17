import{c as r}from"./index-DGlqBRsP.js";/**
 * @license lucide-react v1.8.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const n=[["circle",{cx:"9",cy:"12",r:"1",key:"1vctgf"}],["circle",{cx:"9",cy:"5",r:"1",key:"hp0tcf"}],["circle",{cx:"9",cy:"19",r:"1",key:"fkjjf6"}],["circle",{cx:"15",cy:"12",r:"1",key:"1tmaij"}],["circle",{cx:"15",cy:"5",r:"1",key:"19l28e"}],["circle",{cx:"15",cy:"19",r:"1",key:"f4zoj3"}]],l=r("grip-vertical",n);function o(t){if(!t)return null;try{const e=new URL(t),c=e.hostname.replace(/^www\./,"");if(c==="youtu.be")return e.pathname.split("/").filter(Boolean)[0]||null;if(c.endsWith("youtube.com"))return e.pathname.startsWith("/embed/")||e.pathname.startsWith("/shorts/")?e.pathname.split("/").filter(Boolean)[1]||null:e.searchParams.get("v")}catch{const e=t.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/i);return(e==null?void 0:e[1])??null}return null}function a(t){const e=o(t);return e?`https://www.youtube.com/embed/${e}`:null}export{l as G,a as g};
