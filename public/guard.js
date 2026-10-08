/* 5D Checkers: the safety net. Loaded before the game and depending on nothing, so that when
   the game's script fails to load, or throws before it has drawn anything, the visitor reads a
   short note instead of a blank page. Once the game has drawn, its own error boundary takes over. */
(function () {
  'use strict';

  function started() {
    const root = document.getElementById('root');
    return !!root && root.childElementCount > 0;
  }

  function fail() {
    const note = document.getElementById('boot-failed');
    if (note) note.hidden = false;
  }

  // A failure while the game is starting. Checked a turn later, because React can still be
  // taking a tree down when the error is reported; a page that drew and then emptied is as dead.
  function maybeFail() {
    setTimeout(function () {
      if (!started()) fail();
    }, 0);
  }

  // Capture phase: a script that fails to load fires `error` on its element, and that event does
  // not bubble to window.
  window.addEventListener(
    'error',
    function (e) {
      const el = e.target;
      if (el && el !== window && el.tagName) {
        if (el.tagName.toLowerCase() === 'script') fail();
        return;
      }
      maybeFail();
    },
    true
  );
  window.addEventListener('unhandledrejection', maybeFail);
})();
