import{k as l}from"./index-2-wEN-PQ.js";/**
 * @license lucide-react v1.77.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m={name:"minus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}]]};m.node;const p=l(m);function d(r,s){const n=r[s-1],e=r[s];return!!(n&&e&&!/\s/.test(n)&&!/\s/.test(e))}function y(r,s,n,e){if(n-s<=e)return n;const c=Math.min(s+e,n),o=t=>!d(r.chords,t)&&!d(r.lyrics,t);for(let t=c;t>s;t-=1)if(o(t))return t;for(let t=c+1;t<n;t+=1)if(o(t))return t;return n}function S(r,s){const n=Math.max(r.chords.length,r.lyrics.length),e=Math.max(1,Math.floor(s));if(n<=e)return[r];const c=[];for(let o=0;o<n;){const t=y(r,o,n,e);let i=r.chords.slice(o,t).trimEnd(),a=r.lyrics.slice(o,t).trimEnd();const h=i.search(/\S/),u=a.search(/\S/),f=Math.min(h<0?1/0:h,u<0?1/0:u);Number.isFinite(f)&&f>0&&(i=i.slice(f),a=a.slice(f)),(i.trim()||a.trim())&&c.push({...r,chords:i,lyrics:a}),o=t}return c.length?c:[r]}export{p as M,y as f,S as w};
