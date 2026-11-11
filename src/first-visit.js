/*
 * First visit (1.37): someone who has never used the planner in this browser opens the welcome page
 * instead, which says what it is. Runs in <head>, before the planner draws anything.
 *
 * The planner opens as before for anyone who has used it here (any daily-planner key in storage: the
 * opening seal writes one on the first open), for the installed app, for any address with a query or
 * a hash (?help, a sign-in's answer, and ?start — what the public pages' "Open the planner" links
 * add), and whenever storage can't be read.
 */
(function () {
  try {
    var here = window.location;
    if (here.search || here.hash) return;
    if (window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)) return;
    var store = window.localStorage;
    for (var i = 0; i < store.length; i += 1) {
      if (/^daily-planner/.test(String(store.key(i)))) return;
    }
    here.replace(new URL('welcome/', here.href).href);
  } catch (_) {
    // Storage blocked or no URL support: open the planner.
  }
})();
