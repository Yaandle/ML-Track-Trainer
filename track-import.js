/* track-import.js — load a circuit from an ACC session (CSV or .track.json) instead of tracing one.
   The track is stored in localStorage ('mltt.track') and track.js builds from it on the next load. */
(function () {
  'use strict';

  const KEY = 'mltt.track';
  const $ = (id) => document.getElementById(id);
  const T = window.Track;

  $('trk-name').textContent = T.name;
  const src = T.imported && (JSON.parse(localStorage.getItem(KEY)) || {}).source;
  $('trk-src').textContent = !T.imported ? 'Built-in' : src === 'maker' ? 'Drawn (track maker)' : 'Imported (ACC)';
  $('trk-builtin').disabled = !T.imported;

  function useTrack(track) {
    if (!track || !Array.isArray(track.control) || track.control.length < 10 || !(track.lapMeters > 0)) {
      throw new Error('Not a valid track file.');
    }
    localStorage.setItem(KEY, JSON.stringify({
      name: String(track.name || 'Imported track'),
      lapMeters: track.lapMeters,
      control: track.control,
      corners: track.corners || [],
      widthFactor: track.widthFactor,
      source: track.source || 'import',
    }));
    location.reload();
  }

  $('trk-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('trk-msg').textContent = 'Reading ' + file.name + '…';
    const r = new FileReader();
    r.onload = () => {
      try {
        useTrack(/\.json$/i.test(file.name) ? JSON.parse(r.result) : AccCsv.trackFromCsv(r.result, file.name));
      } catch (err) {
        $('trk-msg').textContent = '⚠ ' + err.message;
      }
    };
    r.readAsText(file);
  });

  $('trk-builtin').addEventListener('click', () => {
    localStorage.removeItem(KEY);
    location.reload();
  });

  // Testing hook: index.html?track=<url of csv or json> (only when served over http)
  const url = new URLSearchParams(location.search).get('track');
  if (url && location.protocol.startsWith('http') && !sessionStorage.getItem('mltt.track.loaded.' + url)) {
    sessionStorage.setItem('mltt.track.loaded.' + url, '1');
    fetch(url).then((res) => res.text()).then((text) => {
      useTrack(/\.json$/i.test(url) ? JSON.parse(text) : AccCsv.trackFromCsv(text, url.split('/').pop()));
    }).catch((err) => { $('trk-msg').textContent = '⚠ ' + err.message; });
  }
})();
