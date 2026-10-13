/* Delivery flags only. Install before the native frame handlers so cached/fast
 * empty responses are distinguishable from placeholders even if the parent
 * guide bundle finishes loading later. No payload content is retained. */
(function(window,document){
 'use strict';
 window.addEventListener('message',function(event){
  if(event.origin!==window.location.origin || event.source!==window.parent) return;
  var type=event.data && event.data.type, root=document.documentElement;
  if(type==='emu-knowledge-loading') root.removeAttribute('data-tour-posts-ready');
  if(type==='emu-knowledge-posts') root.setAttribute('data-tour-posts-ready','true');
  if(type==='emu-discussion-rooms') root.setAttribute('data-tour-rooms-ready','true');
  if(type==='emu-knowledge-panel-data' && event.data.kind==='library') root.setAttribute('data-tour-library-ready','true');
 });
 document.addEventListener('click',function(event){
  if(event.target.closest('[data-command="library"]')) document.documentElement.removeAttribute('data-tour-library-ready');
 },true);
})(window,document);
