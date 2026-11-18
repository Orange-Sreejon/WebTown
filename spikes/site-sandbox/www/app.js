// S-01 stand-in for the WebTown app: owns the canaries, mounts the host frame, validates every
// message by source and schema, shows the external-link confirmation, and exposes window.__app for
// the tests. Throwaway; not shipped.
;(function () {
  'use strict'
  var ORIGIN = location.origin
  var DENY = ['camera', 'microphone', 'geolocation', 'display-capture', 'fullscreen', 'payment', 'usb', 'serial',
    'hid', 'bluetooth', 'midi', 'clipboard-read', 'clipboard-write', 'publickey-credentials-get', 'screen-wake-lock',
    'xr-spatial-tracking', 'autoplay', 'encrypted-media', 'picture-in-picture', 'accelerometer', 'gyroscope',
    'magnetometer'].map(function (f) { return f + " 'none'" }).join('; ')

  // Canaries: things a resident page must never be able to read or reach.
  window.__secret = 'webtown-secret'
  try { localStorage.setItem('wt-canary', 'secret'); sessionStorage.setItem('wt-canary', 'secret') } catch (e) {}
  document.cookie = 'wt-canary=secret; path=/'
  var bus = new EventTarget()                      // stands in for lib/event-bus; nothing may reach it
  bus.addEventListener('close', function () { state.busEvents++ })
  window.__bus = bus

  var state = {
    accepted: [], foreign: [], malformed: 0, rejectedByHost: [], busEvents: 0, rateLimited: 0, unexpected: 0,
    loads: 0, renders: 0, opened: [], history: [], current: null, mode: 'product', files: null,
    confirm: null, probes: [], appMessagesIn: 0,
  }
  var hostFrame = null
  var stage = document.getElementById('stage')
  var status = document.getElementById('status')
  var confirmBar = document.getElementById('confirm')
  var inWindowStart = 0, inWindowCount = 0

  function sample(data) {
    var s
    try { s = JSON.stringify(data) } catch (e) { s = String(data) }
    return typeof s === 'string' ? s.slice(0, 600) : String(s)
  }

  function mount(withAttacker) {
    stage.textContent = ''
    hostFrame = document.createElement('iframe')
    hostFrame.id = 'host'
    hostFrame.setAttribute('sandbox', 'allow-scripts')
    hostFrame.setAttribute('referrerpolicy', 'no-referrer')
    hostFrame.setAttribute('allow', DENY)
    hostFrame.setAttribute('title', 'Resident website host')
    hostFrame.src = '/site-host.html'
    stage.appendChild(hostFrame)
    if (withAttacker) {
      var a = document.createElement('iframe')
      a.id = 'attacker'
      a.setAttribute('sandbox', 'allow-scripts')
      a.src = '/attacker.html'
      stage.appendChild(a)
    }
  }

  function sendRender(html) {
    state.renders++
    hostFrame.contentWindow.postMessage({ t: 'render', html: html }, '*')   // opaque target: '*' is the only option
  }

  function navigateTo(path, push) {
    state.current = path
    if (push !== false) state.history.push(path)
    status.textContent = 'page: ' + path
    sendRender(SpikeBuilder.build(state.files, path, state.mode, ORIGIN))
  }

  function showConfirm(href) {
    state.confirm = href
    document.getElementById('confirm-text').textContent = 'This page wants to open ' + new URL(href).host + '. '
    confirmBar.classList.add('on')
  }
  function hideConfirm() { state.confirm = null; confirmBar.classList.remove('on') }
  document.getElementById('confirm-open').addEventListener('click', function () {
    var href = state.confirm
    hideConfirm()
    if (href && SpikeBuilder.isExternalAllowed(href)) {
      state.opened.push(href)
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  })
  document.getElementById('confirm-cancel').addEventListener('click', hideConfirm)
  document.getElementById('back').addEventListener('click', function () {
    if (state.history.length > 1) { state.history.pop(); navigateTo(state.history[state.history.length - 1], false) }
  })
  document.getElementById('home').addEventListener('click', function () { navigateTo('index.html') })

  window.addEventListener('message', function (event) {
    state.appMessagesIn++
    // Rule 1: only the one window this app created may talk to it.
    if (!hostFrame || event.source !== hostFrame.contentWindow) { state.foreign.push(sample(event.data)); return }
    // Rule 2: the host is an opaque origin, so its origin is exactly "null".
    if (event.origin !== 'null') { state.foreign.push('bad-origin:' + event.origin); return }
    // Rule 3: rate limit.
    var now = Date.now()
    if (now - inWindowStart >= 1000) { inWindowStart = now; inWindowCount = 0 }
    if (++inWindowCount > 30) { state.rateLimited++; return }
    // Rule 4: closed schema.
    var d = event.data
    if (!d || typeof d !== 'object' || typeof d.t !== 'string') { state.malformed++; return }
    switch (d.t) {
      case 'ready': state.accepted.push('ready'); state.ready = true; break
      case 'rendered': state.accepted.push('rendered'); break
      case 'loaded': state.loads++; break
      case 'rate-limited': state.rateLimited++; break
      case 'loop-detected': state.loopDetected = (state.loopDetected || 0) + 1; break
      case 'unexpected-nav': state.unexpected++; status.textContent = 'page tried to leave; reset'; break
      case 'rejected': state.rejectedByHost.push({ from: d.from, sample: String(d.sample).slice(0, 600) }); break
      case 'nav':
        if (d.kind === 'page' && typeof d.value === 'string' && d.value.length <= 2048) {
          state.accepted.push('nav:page')
          var path = d.value.split('#')[0]
          if (state.files[path] && /\.html?$/i.test(path)) navigateTo(path)
          else navigateTo(path)   // the builder renders its own "page not found"
        } else if (d.kind === 'external' && typeof d.value === 'string' && d.value.length <= 2048) {
          state.accepted.push('nav:external')
          if (SpikeBuilder.isExternalAllowed(d.value)) showConfirm(d.value)
        } else { state.malformed++ }
        break
      default: state.malformed++
    }
  })

  window.__app = {
    state: state,
    mount: function (withAttacker) { state.ready = false; mount(withAttacker) },
    render: function (name, mode, path) {
      state.mode = mode
      state.files = JSON.parse(JSON.stringify(SpikeFixtures[name].files))
      state.history = []
      navigateTo(path || 'index.html')
    },
    renderFiles: function (files, mode, path) {
      state.mode = mode
      state.files = JSON.parse(JSON.stringify(files))
      state.history = []
      navigateTo(path || 'index.html')
    },
    stop: function () { if (hostFrame) { hostFrame.remove(); hostFrame = null } },
    reset: function () {
      state.accepted = []; state.foreign = []; state.malformed = 0; state.rejectedByHost = []; state.busEvents = 0
      state.rateLimited = 0; state.unexpected = 0; state.opened = []; state.loopDetected = 0; hideConfirm()
    },
    names: function () { return Object.keys(SpikeFixtures) },
  }
  // The attacker frame reports its own probe results to us; they are foreign by construction.
})()
