/* Austino Pro: hides the "Reviews" menu link when the Reviews page is switched off in the admin page. */
(function(){
  'use strict';
  if((window.SITE_CONFIG || {}).reviewsEnabled !== false) return;
  function hide(){
    var a = document.querySelectorAll('a[href="reviews.html"]');
    for(var i = 0; i < a.length; i++){ var li = a[i].closest('li'); (li || a[i]).remove(); }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',hide); else hide();
})();
