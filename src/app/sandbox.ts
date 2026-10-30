/**
 * Built pages run in a sandbox where touching localStorage or sessionStorage throws, and free models
 * often forget to guard it. This script, put first in the page, swaps in an in-memory store so the page works.
 */
const STORAGE_SHIM =
  '<script>(function(){function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}' +
  '["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(_){}}})})();</script>';

/** The page with the storage shim (and anything else in `extra`) at the very start of <head>. */
export function sandboxed(html: string, extra = ""): string {
  const add = STORAGE_SHIM + extra;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + add);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + add);
  return add + html;
}
