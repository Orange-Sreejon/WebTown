// S-01 fixtures: tiny resident websites, each trying one thing. Throwaway, not shipped.
// B is the beacon origin; any request that reaches it is recorded by the spike server, which is
// the real evidence. If resident script ever runs, EXEC shouts to every parent and to the beacon.
;(function () {
  'use strict'
  var B = 'http://127.0.0.1:8765'
  var PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  // Announces execution to every reachable parent and to the beacon. Any trace of it = script ran.
  function exec(id) {
    return (
      'try{for(var w=window;;w=w.parent){w.postMessage({t:"exec",id:' + JSON.stringify(id) + '},"*");if(w===w.parent)break}}catch(e){}' +
      'try{new Image().src=' + JSON.stringify(B + '/exec/') + '+' + JSON.stringify(id) + '}catch(e){}'
    )
  }
  // A page made only of one file's text.
  function page(body, headExtra) {
    return { 'index.html': { text: '<!doctype html><html><head><meta charset="utf-8">' + (headExtra || '') + '</head><body>' + body + '</body></html>' } }
  }

  var F = {}

  // ---- script execution: every variant must stay silent in product mode ----
  F['script-inline'] = { files: page('<h1>inline</h1><script>' + exec('inline') + '<\/script>') }
  F['script-defer'] = { files: page('<h1>defer</h1><script defer>' + exec('defer') + '<\/script>') }
  F['script-module'] = { files: { 'index.html': { text: '<!doctype html><body><script type="module">' + exec('module') + '<\/script>' } } }
  F['script-external'] = { files: { 'index.html': { text: '<!doctype html><body><script src="app.js"><\/script>' }, 'app.js': { text: exec('external-file') } } }
  F['script-beacon'] = { files: page('<script src="' + B + '/exec/remote.js"><\/script>') }
  F['script-event-attr'] = { files: page('<img src="' + PNG + '" onload="' + exec('onload-attr').replace(/"/g, '&quot;') + '"><body onclick="' + exec('onclick-attr').replace(/"/g, '&quot;') + '">click me</body>') }
  F['script-js-url'] = { files: page('<a id="jsurl" href="javascript:' + exec('js-url') + '">x</a><iframe src="javascript:' + exec('js-url-frame').replace(/"/g, '&quot;') + '"></iframe>') }
  F['script-svg'] = { files: { 'index.html': { text: '<!doctype html><body><img src="x.svg">' }, 'x.svg': { text: '<svg xmlns="http://www.w3.org/2000/svg"><script>' + exec('svg-script') + '<\/script></svg>' } } }
  F['script-nonce-guess'] = { files: page('<script nonce="wtHost1">' + exec('nonce-host') + '<\/script><script nonce="wtNav1">' + exec('nonce-nav') + '<\/script>') }

  // ---- network egress: every one must leave the beacon log empty in product mode ----
  F['net-img'] = { files: page('<img src="' + B + '/img.png">') }
  F['net-css-bg'] = { files: { 'index.html': { text: '<!doctype html><html><head><link rel="stylesheet" href="s.css"></head><body><div class="x">hi</div></body></html>' }, 's.css': { text: '.x{background:url(' + B + '/bg.png)}' } } }
  F['net-css-import'] = { files: { 'index.html': { text: '<!doctype html><html><head><style>@import url(' + B + '/i.css);</style></head><body>hi</body></html>' } } }
  F['net-font'] = { files: { 'index.html': { text: '<!doctype html><html><head><style>@font-face{font-family:x;src:url(' + B + '/f.woff2)}body{font-family:x}</style></head><body>hi</body></html>' } } }
  F['net-media'] = { files: page('<audio src="' + B + '/a.mp3" autoplay></audio><video src="' + B + '/v.mp4" autoplay></video>') }
  F['net-iframe'] = { files: page('<iframe src="' + B + '/framed.html"></iframe>') }
  F['net-object'] = { files: page('<object data="' + B + '/o.pdf"></object><embed src="' + B + '/e.swf">') }
  F['net-form-get'] = { files: page('<form id="f" action="' + B + '/form" method="get"><input name="q" value="1"><button>go</button></form>') }
  F['net-form-post'] = { files: page('<form id="f" action="' + B + '/form" method="post"><input name="q" value="1"><button>go</button></form>') }
  F['net-anchor-ping'] = { files: page('<a id="pinglink" href="' + B + '/dest" ping="' + B + '/ping">x</a>') }
  F['net-prefetch'] = { files: { 'index.html': { text: '<!doctype html><html><head><link rel="preload" as="image" href="' + B + '/pl.png"><link rel="prefetch" href="' + B + '/pf"><link rel="preconnect" href="' + B + '"><link rel="dns-prefetch" href="' + B + '"></head><body>hi</body></html>' } } }
  F['net-meta-refresh'] = { files: { 'index.html': { text: '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=' + B + '/refresh"></head><body>hi</body></html>' } } }
  F['net-base-steal'] = { files: { 'index.html': { text: '<!doctype html><html><head><base href="' + B + '/"></head><body><img src="rel.png"><a id="rel" href="rel.html">x</a></body></html>' } } }

  // ---- script-driven egress (only fires if script runs; run in diagnostic mode too) ----
  F['net-fetch'] = { files: page('<script>' + exec('pre-fetch') + 'fetch(' + JSON.stringify(B + '/fetch') + ').catch(function(){});' +
    'try{var x=new XMLHttpRequest();x.open("GET",' + JSON.stringify(B + '/xhr') + ');x.send()}catch(e){}' +
    'try{navigator.sendBeacon(' + JSON.stringify(B + '/sendbeacon') + ',"x")}catch(e){}' +
    'try{new WebSocket(' + JSON.stringify('ws://127.0.0.1:8765/ws') + ')}catch(e){}' +
    'try{new EventSource(' + JSON.stringify(B + '/sse') + ')}catch(e){}<\/script>') }
  F['net-webrtc'] = { files: page('<script>' + exec('pre-webrtc') + 'try{var p=new RTCPeerConnection({iceServers:[{urls:"stun:127.0.0.1:3478"}]});' +
    'p.createDataChannel("x");p.createOffer().then(function(o){return p.setLocalDescription(o)}).catch(function(){})}catch(e){}<\/script>') }

  // ---- isolation and navigation (run in diagnostic mode, where resident script runs, to prove
  //      the opaque origin denies these even if script ever executed) ----
  F['iso-parent-dom'] = { files: page('<script>' + exec('iso') + 'var r={};' +
    'try{r.parentTitle=String(parent.document.title)}catch(e){r.parentTitle="blocked:"+e.name}' +
    'try{r.topTitle=String(top.document.title)}catch(e){r.topTitle="blocked:"+e.name}' +
    'try{r.frameEl=String(window.frameElement)}catch(e){r.frameEl="blocked:"+e.name}' +
    'try{r.origin=String(location.origin)}catch(e){r.origin="err"}' +
    'try{parent.postMessage({t:"probe-iso",r:r},"*")}catch(e){}<\/script>') }
  F['iso-storage'] = { files: page('<script>' + exec('iso') + 'var r={};' +
    'try{localStorage.setItem("a","b");r.local="ok"}catch(e){r.local="blocked:"+e.name}' +
    'try{sessionStorage.setItem("a","b");r.session="ok"}catch(e){r.session="blocked:"+e.name}' +
    'try{r.cookieWrite=(document.cookie="a=b")||"set";r.cookie=document.cookie}catch(e){r.cookie="blocked:"+e.name}' +
    'try{r.idb=typeof indexedDB;indexedDB.open("x")}catch(e){r.idb="blocked:"+e.name}' +
    'try{r.caches=typeof caches;caches.keys()}catch(e){r.caches="blocked:"+e.name}' +
    'try{navigator.serviceWorker.register("sw.js").catch(function(){});r.sw="attempted"}catch(e){r.sw="blocked:"+e.name}' +
    'try{parent.postMessage({t:"probe-storage",r:r},"*")}catch(e){}<\/script>') }
  F['nav-top'] = { files: page('<script>' + exec('nav') + 'var r={};' +
    'try{top.location="' + B + '/nav-top";r.top="allowed"}catch(e){r.top="blocked:"+e.name}' +
    'try{window.open("' + B + '/popup");r.open="allowed"}catch(e){r.open="blocked:"+e.name}' +
    'try{location.href="' + B + '/self-nav";r.self="allowed"}catch(e){r.self="blocked:"+e.name}' +
    'try{parent.postMessage({t:"probe-nav",r:r},"*")}catch(e){}<\/script>') }
  F['nav-self-link'] = { files: page('<a id="ext" href="' + B + '/anchor-top" target="_top">top</a><a id="ext2" href="' + B + '/anchor-blank" target="_blank">blank</a>') }
  F['nav-dialogs'] = { files: page('<script>' + exec('dlg') + 'var r={};' +
    'try{alert("x");r.alert="allowed"}catch(e){r.alert="blocked:"+e.name}' +
    'try{r.confirm=String(confirm("x"))}catch(e){r.confirm="blocked:"+e.name}' +
    'try{print();r.print="allowed"}catch(e){r.print="blocked:"+e.name}' +
    'try{parent.postMessage({t:"probe-dialogs",r:r},"*")}catch(e){}<\/script>') }

  // ---- host-frame forgery: the resident posts messages shaped like real ones, at the host and the app ----
  F['forge-messages'] = { files: page('<script>' + exec('forge') +
    'var msgs=[{t:"render",html:"<h1 id=pwned>x</h1>"},{t:"ready"},{t:"rendered"},{t:"nav",kind:"external",value:"https://evil.example/"},{type:"close"},{type:"enter-edit"}];' +
    'for(var i=0;i<msgs.length;i++){try{parent.postMessage(msgs[i],"*")}catch(e){}try{top.postMessage(msgs[i],"*")}catch(e){}}<\/script>') }
  // Floods navigation messages to test the host rate limit (needs the nav page, so it is a clean message path).
  F['forge-flood'] = { files: page('<script>' + exec('flood') + 'for(var i=0;i<200;i++){parent.postMessage({t:"nav",kind:"external",value:"https://example.com/"+i},"*")}<\/script>') }


  // ---- more static egress routes (no script needed) ----
  F['net-css-imageset'] = { files: { 'index.html': { text: '<!doctype html><html><head><style>.x{background-image:image-set("' + B + '/is.png" 1x)}</style></head><body><div class="x">hi</div></body></html>' } } }
  F['net-css-misc'] = { files: { 'index.html': { text: '<!doctype html><html><head><style>.a{cursor:url(' + B + '/cur.cur),auto}.b{list-style-image:url(' + B + '/li.png)}.c::before{content:url(' + B + '/ct.png)}.d{border-image:url(' + B + '/bi.png) 1}.e{mask-image:url(' + B + '/mk.png)}</style></head><body><p class="a">a</p><ul class="b"><li>b</li></ul><p class="c">c</p><p class="d">d</p><p class="e">e</p></body></html>' } } }
  F['net-picture-input'] = { files: page('<picture><source srcset="' + B + '/p1.png 1x, ' + B + '/p2.png 2x"><img src="' + B + '/p3.png"></picture><input type="image" src="' + B + '/in.png"><img src="' + PNG + '" srcset="' + B + '/ss.png 2x"><table background="' + B + '/tb.png"><tr><td>x</td></tr></table>') }
  F['net-svg-use'] = { files: page('<svg width="10" height="10"><use href="' + B + '/s.svg#a"></use><image href="' + B + '/si.png"></image></svg>') }
  F['net-svg-img'] = { files: { 'index.html': { text: '<!doctype html><body><img id="svg" src="a.svg">' }, 'a.svg': { text: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="' + B + '/inside-svg.png" width="20" height="20"/><style>@import url(' + B + '/svg.css);</style><rect width="20" height="20" fill="red"/></svg>' } } }
  F['net-anchor-click'] = { files: page('<a id="a1" href="' + B + '/clicked-same">same</a><a id="a2" href="' + B + '/clicked-top" target="_top">top</a><a id="a3" href="' + B + '/clicked-blank" target="_blank">blank</a><a id="a4" href="' + B + '/clicked-dl" download>dl</a><a id="a5" href="mailto:a@example.com">mail</a>') }
  F['net-form-click'] = { files: page('<form id="f1" action="' + B + '/f-get"><input name="q"><button id="b1">go</button></form><form id="f2" method="post" action="' + B + '/f-post"><button id="b2">post</button></form><form id="f3"><button id="b3" formaction="' + B + '/f-formaction">fa</button></form>') }

  // ---- heavy pages, for "Close responsiveness" (product mode; no script) ----
  var rows = ''
  for (var i = 0; i < 60000; i++) rows += '<div class="r"><span>' + i + '</span></div>'
  F['heavy-dom'] = { files: page(rows, '<style>.r{padding:1px;border:1px solid #888;animation:p 1s infinite alternate}@keyframes p{from{opacity:.2;filter:blur(1px)}to{opacity:1}}</style>') }
  // Only with scripts allowed (diagnostic): a script that never returns.
  F['loop-forever'] = { files: page('<h1>loop</h1><script>' + exec('loop-start') + 'for(;;){}<\/script>') }
  // Navigating the resident frame to one of WebTown's own pages (same origin as the host page).
  F['nav-same-origin'] = { files: page('<a id="so" href="/other-anchor.html">same-origin link</a><script>' + exec('so') +
    'setTimeout(function(){location.href="/other-script.html"},300)<\/script>') }
  // A page that fits within the approved 1 MB text-file limit but is as heavy as that allows.
  var rows1 = '', n1 = 0
  while (rows1.length < 1000000 - 400) { rows1 += '<div class="r"><span>' + (n1++) + '</span></div>' }
  F['heavy-1mb'] = { files: page(rows1, '<style>.r{padding:1px;border:1px solid #888;animation:p 1s infinite alternate}@keyframes p{from{opacity:.2;filter:blur(1px)}to{opacity:1}}</style>'), elements: n1 }
  F['heavy-1mb-static'] = { files: page(rows1, '<style>.r{padding:1px;border:1px solid #888}</style>'), elements: n1 }
  // ---- good citizens: links and assets that should work ----
  F['ok-link-internal'] = { files: {
    'index.html': { text: '<!doctype html><body><h1 id="home">Home</h1><a id="go" href="about.html">About</a><a id="deep" href="art/x.html">Art</a>' },
    'about.html': { text: '<!doctype html><body><h1 id="about">About</h1><a id="back" href="index.html">Home</a>' },
    'art/x.html': { text: '<!doctype html><body><h1 id="art">Art</h1><a id="up" href="../index.html">Home</a>' },
  } }
  F['ok-link-external'] = { files: page('<a id="ext" href="https://example.com/page?q=1#f">example</a><a id="bad" href="http://example.com/">http</a><a id="js" href="javascript:alert(1)">js</a>') }
  F['ok-image'] = { files: { 'index.html': { text: '<!doctype html><body><img id="img" src="cat.png" alt="cat"><div id="bg" style="background:url(cat.png)">x</div>' }, 'cat.png': { dataUrl: PNG } } }
  F['ok-missing'] = { files: page('<a id="broken" href="nope.html">broken</a><img id="mi" src="missing.png">') }

  window.SpikeFixtures = F
})()
