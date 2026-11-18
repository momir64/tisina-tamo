// Runs in the page's own JavaScript world (manifest "world": "MAIN"), because YouTube's player
// API (mute / unMute) is only visible there, not to content.js in its isolated world.
//
// Setting video.muted directly leaves YouTube's own mute state untouched: the player UI keeps
// showing "not muted" and YouTube re-applies its state on seeks, quality changes and ads, which
// silently undoes the mute. Going through the player API changes the state YouTube itself uses.
window.addEventListener("tisina-tamo:mute", (e) => {
  const player = document.getElementById("movie_player");
  try {
    if (e.detail === "1") player?.mute?.();
    else player?.unMute?.();
  } catch {}
});
