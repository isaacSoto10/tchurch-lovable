import{f as l}from"./index-DfJ4aXXZ.js";/**
 * @license lucide-react v1.8.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=[["path",{d:"M5 12h14",key:"1ays0h"}]],p=l("minus",m);function d(r,n){const s=r[n-1],o=r[n];return!!(s&&o&&!/\s/.test(s)&&!/\s/.test(o))}function y(r,n,s,o){if(s-n<=o)return s;const e=Math.min(n+o,s),c=t=>!d(r.chords,t)&&!d(r.lyrics,t);for(let t=e;t>n;t-=1)if(c(t))return t;for(let t=e+1;t<s;t+=1)if(c(t))return t;return s}function S(r,n){const s=Math.max(r.chords.length,r.lyrics.length),o=Math.max(1,Math.floor(n));if(s<=o)return[r];const e=[];for(let c=0;c<s;){const t=y(r,c,s,o);let i=r.chords.slice(c,t).trimEnd(),a=r.lyrics.slice(c,t).trimEnd();const h=i.search(/\S/),u=a.search(/\S/),f=Math.min(h<0?1/0:h,u<0?1/0:u);Number.isFinite(f)&&f>0&&(i=i.slice(f),a=a.slice(f)),(i.trim()||a.trim())&&e.push({...r,chords:i,lyrics:a}),c=t}return e.length?e:[r]}export{p as M,y as f,S as w};
