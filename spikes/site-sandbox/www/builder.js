// S-01 prototype of the page builder (design 16.4). Throwaway: it exists to test the sandbox
// policy, not to be the real builder (S-04). Parses the resident's HTML inertly with DOMParser,
// never runs it, and returns the srcdoc text for the resident frame.
//
// Modes, so the spike can tell which protection comes from where:
//   product     sanitise + resident CSP <meta> + non-network <base> + rewrite links and assets
//   raw-csp     resident CSP <meta> only; resident HTML otherwise untouched
//   raw-none    nothing added: only the policy inherited from the host page applies
//   diagnostic  as raw-none; used with fixtures that carry the host's (public) nonce, to probe
//               what an opaque frame could do if resident script ever ran
;(function () {
  'use strict'

  var RESIDENT_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' data:; img-src data:; " +
    "font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; " +
    "object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri webtown-site:"

  var REMOVE_ELEMENTS = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'base',
    'fencedframe']
  var BLOCKED_LINK_RELS = ['preload', 'prefetch', 'prerender', 'preconnect', 'dns-prefetch', 'modulepreload',
    'manifest', 'import', 'serviceworker', 'pingback']
  var RESOURCE_ATTRS = ['src', 'srcset', 'poster', 'background', 'data', 'lowsrc', 'dynsrc', 'xlink:href', 'href']
  var DROP_ATTRS = ['nonce', 'ping', 'target', 'formaction', 'srcdoc', 'action', 'formtarget', 'http-equiv-refresh']

  function isExternalAllowed(value) {
    try {
      var u = new URL(value)
      if (u.protocol !== 'https:' || u.username || u.password) return false
      var h = u.hostname
      if (h === 'localhost' || /\.(local|internal|localhost|lan)$/.test(h)) return false
      if (/^\d+(\.\d+){3}$/.test(h) || h.charAt(0) === '[') return false
      return h.indexOf('.') > 0
    } catch (e) { return false }
  }

  /** 'sub/a.html' + '../b.html#x' -> { path: 'b.html', frag: '#x' }; null if it leaves the site. */
  function resolve(fromPath, ref) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.indexOf('//') === 0) return null
    var hashAt = ref.indexOf('#')
    var frag = hashAt >= 0 ? ref.slice(hashAt) : ''
    var bare = (hashAt >= 0 ? ref.slice(0, hashAt) : ref).split('?')[0]
    var parts = ref.charAt(0) === '/' ? [] : fromPath.split('/').slice(0, -1)
    bare.split('/').forEach(function (seg) {
      if (seg === '' || seg === '.') return
      if (seg === '..') parts.pop()
      else parts.push(seg)
    })
    var path = parts.join('/')
    if (path === '' || /\/$/.test(bare)) path = (path ? path + '/' : '') + 'index.html'
    return { path: path, frag: frag }
  }

  function toBase64(text) {
    var bytes = new TextEncoder().encode(text)
    var s = ''
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  }

  function assetUrl(files, fromPath, ref) {
    var r = resolve(fromPath, ref)
    if (!r) return null
    var f = files[r.path]
    if (!f) return null
    if (f.dataUrl) return f.dataUrl
    if (/\.css$/.test(r.path)) return 'data:text/css;base64,' + toBase64(rewriteCss(files, r.path, f.text))
    return null
  }

  function rewriteCss(files, fromPath, css) {
    return css
      .replace(/@import\s+(url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?[^;]*;/gi, function (m, u, ref) {
        var data = assetUrl(files, fromPath, ref)
        return data ? '@import url("' + data + '");' : ''
      })
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (m, q, ref) {
        if (/^data:(image|font)\//i.test(ref)) return m
        var data = assetUrl(files, fromPath, ref)
        return data ? 'url("' + data + '")' : 'url("data:,")'
      })
      .replace(/image-set\(/gi, 'image-set(')
  }

  function navUrl(appOrigin, params) {
    return appOrigin + '/site-nav.html#' + new URLSearchParams(params).toString()
  }

  function sanitise(doc, files, path, appOrigin) {
    REMOVE_ELEMENTS.forEach(function (tag) {
      Array.prototype.slice.call(doc.getElementsByTagName(tag)).forEach(function (el) { el.remove() })
    })
    // Without scripts, <noscript> content is what the page means to show.
    Array.prototype.slice.call(doc.getElementsByTagName('noscript')).forEach(function (el) {
      while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el)
      el.remove()
    })
    Array.prototype.slice.call(doc.querySelectorAll('meta[http-equiv]')).forEach(function (el) {
      var kind = (el.getAttribute('http-equiv') || '').toLowerCase()
      if (kind === 'refresh' || kind === 'set-cookie') el.remove()
    })
    Array.prototype.slice.call(doc.querySelectorAll('link[rel]')).forEach(function (el) {
      var rels = (el.getAttribute('rel') || '').toLowerCase().split(/\s+/)
      if (rels.some(function (r) { return BLOCKED_LINK_RELS.indexOf(r) >= 0 })) { el.remove(); return }
      if (rels.indexOf('stylesheet') >= 0 || rels.indexOf('icon') >= 0) {
        var data = assetUrl(files, path, el.getAttribute('href') || '')
        if (data) el.setAttribute('href', data); else el.remove()
      }
    })

    var all = doc.getElementsByTagName('*')
    for (var i = 0; i < all.length; i++) {
      var el = all[i]
      var tag = el.localName
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase()
        if (name.indexOf('on') === 0 || DROP_ATTRS.indexOf(name) >= 0) el.removeAttribute(attr.name)
      })

      // Links: internal pages and approved external addresses go through WebTown's navigation page.
      if ((tag === 'a' || tag === 'area') && (el.hasAttribute('href') || el.hasAttribute('xlink:href'))) {
        var ref = (el.getAttribute('href') || el.getAttribute('xlink:href') || '').trim()
        el.removeAttribute('xlink:href')
        if (ref.charAt(0) === '#') { el.setAttribute('href', ref); continue }
        var r = resolve(path, ref)
        if (r && /\.html?$/i.test(r.path)) {
          el.setAttribute('href', navUrl(appOrigin, { k: 'page', p: r.path + r.frag }))
        } else if (isExternalAllowed(ref)) {
          el.setAttribute('href', navUrl(appOrigin, { k: 'external', u: ref }))
        } else {
          el.removeAttribute('href')
          el.setAttribute('aria-disabled', 'true')
        }
        continue
      }

      RESOURCE_ATTRS.forEach(function (name) {
        if (!el.hasAttribute(name)) return
        if (name === 'href' && tag === 'link') return
        var value = (el.getAttribute(name) || '').trim()
        if (name === 'srcset') {
          var kept = value.split(',').map(function (part) {
            var bits = part.trim().split(/\s+/)
            var data = /^data:image\//i.test(bits[0]) ? bits[0] : assetUrl(files, path, bits[0])
            return data ? [data].concat(bits.slice(1)).join(' ') : null
          }).filter(Boolean)
          if (kept.length) el.setAttribute(name, kept.join(', ')); else el.removeAttribute(name)
          return
        }
        if (/^data:(image|audio|video|font)\//i.test(value)) return
        var data = assetUrl(files, path, value)
        if (data) el.setAttribute(name, data); else el.removeAttribute(name)
      })

      if (el.hasAttribute('style')) el.setAttribute('style', rewriteCss(files, path, el.getAttribute('style')))
      if (tag === 'style') el.textContent = rewriteCss(files, path, el.textContent)
    }
  }

  function inject(doc, withBase, path) {
    var head = doc.head
    var charset = doc.createElement('meta')
    charset.setAttribute('charset', 'utf-8')
    var csp = doc.createElement('meta')
    csp.setAttribute('http-equiv', 'Content-Security-Policy')
    csp.setAttribute('content', RESIDENT_CSP)
    var first = [charset, csp]
    if (withBase) {
      var base = doc.createElement('base')
      base.setAttribute('href', 'webtown-site:/site/' + path)
      first.push(base)
    }
    for (var i = first.length - 1; i >= 0; i--) head.insertBefore(first[i], head.firstChild)
  }

  function notFound(path) {
    return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
      RESIDENT_CSP + '"></head><body><h1 id="wt-not-found">Page not found</h1><p>' +
      String(path).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';' }) + '</p></body></html>'
  }

  function build(files, path, mode, appOrigin) {
    var file = files[path]
    if (!file || typeof file.text !== 'string') return notFound(path)
    if (mode === 'raw-none') return file.text
    // diagnostic: the page's own scripts carry the host's public nonce so they CAN run, to show what an opaque
    // frame could and could not do if resident script ever ran. Never used for real pages.
    if (mode === 'diagnostic') return file.text.replace(/<script(?![^>]*nonce)/gi, '<script nonce="wtHost1"')
    var doc = new DOMParser().parseFromString(file.text, 'text/html')
    if (mode === 'product') sanitise(doc, files, path, appOrigin)
    inject(doc, mode === 'product', path)
    return '<!doctype html>\n' + doc.documentElement.outerHTML
  }

  window.SpikeBuilder = { build: build, isExternalAllowed: isExternalAllowed, resolve: resolve, RESIDENT_CSP: RESIDENT_CSP }
})()
